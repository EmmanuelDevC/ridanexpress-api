const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;
const authOrderModel = require('../../models/authOrder');
const customerOrder = require('../../models/customerOrder');
const cardModel = require('../../models/cardModel');
const myShopWallet = require('../../models/myShopWallet');
const sellerWallet = require('../../models/sellerWallet');
const sellerModel = require('../../models/sellerModel');
const productModel = require('../../models/productModel');
const KwikService = require('../../services/KwikService');
const MapboxService = require('../../services/MapboxService');
const axios = require('axios');
const { responseReturn } = require('../../utiles/response');
const moment = require('moment');

class OrderController {
    constructor() {
        this.paymentTimeouts = new Map();
        this.paymentTimeout = parseInt(process.env.PAYMENT_TIMEOUT_MS) || 900000;
        this.currency = 'NGN';
        this.maxRetries = 3;

        // Bind all methods
        this.place_order = this.place_order.bind(this);
        this.generateTxRef = this.generateTxRef.bind(this);
        this.get_customer_databorad_data = this.get_customer_databorad_data.bind(this);
        this.get_orders = this.get_orders.bind(this);
        this.get_order = this.get_order.bind(this);
        this.create_payment = this.create_payment.bind(this);
        this.order_confirm = this.order_confirm.bind(this);
        this.get_admin_orders = this.get_admin_orders.bind(this);
        this.get_admin_order = this.get_admin_order.bind(this);
        this.admin_order_status_update = this.admin_order_status_update.bind(this);
        this.get_seller_orders = this.get_seller_orders.bind(this);
        this.get_seller_order = this.get_seller_order.bind(this);
        this.get_seller_addresses = this.get_seller_addresses.bind(this);
        this.get_seller_phones = this.get_seller_phones.bind(this);
        this.seller_order_status_update = this.seller_order_status_update.bind(this);
        this.handle_flutterwave_webhook = this.handle_flutterwave_webhook.bind(this);

        // Kwik methods
        this.accept_order_with_kwik = this.accept_order_with_kwik.bind(this);
        this.track_delivery = this.track_delivery.bind(this);
        this.cancel_kwik_delivery = this.cancel_kwik_delivery.bind(this);
        this.kwik_webhook = this.kwik_webhook.bind(this);
        this.test_kwik_integration = this.test_kwik_integration.bind(this);
        this.create_pickup_only = this.create_pickup_only.bind(this);
        this.schedule_pickup = this.schedule_pickup.bind(this);
        this.validate_address = this.validate_address.bind(this);
        this.get_kwik_vehicles = this.get_kwik_vehicles.bind(this);
        this.get_kwik_loaders = this.get_kwik_loaders.bind(this);
        this.kwik_health_check = this.kwik_health_check.bind(this);

        // Mapbox methods
        this.mapbox_geocode = this.mapbox_geocode.bind(this);
        this.mapbox_reverse_geocode = this.mapbox_reverse_geocode.bind(this);
        this.mapbox_health_check = this.mapbox_health_check.bind(this);
        this.mapbox_validate_address = this.mapbox_validate_address.bind(this);
        this.mapbox_calculate_route = this.mapbox_calculate_route.bind(this);
        this.mapbox_batch_geocode = this.mapbox_batch_geocode.bind(this);
    }

    // ==================== CORE ORDER METHODS ====================

    generateTxRef() {
        return `FLW-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }

    // NEW METHOD: Get seller addresses for shipping calculation
    async get_seller_addresses(req, res) {
        try {
            const { sellerIds } = req.body;

            if (!sellerIds || !Array.isArray(sellerIds)) {
                return responseReturn(res, 400, {
                    error: 'sellerIds array is required'
                });
            }

            const sellerAddresses = [];

            for (const sellerId of sellerIds) {
                try {
                    const seller = await sellerModel.findById(sellerId).select('name email phone location shopInfo');

                    if (seller) {
                        const sellerLocation = await this.getSellerLocation(sellerId);

                        sellerAddresses.push({
                            sellerId: seller._id,
                            shopName: seller.shopInfo?.shopName || seller.name,
                            name: seller.name,
                            phone: seller.phone || '08000000000',
                            email: seller.email,
                            address: sellerLocation.address,
                            coordinates: {
                                latitude: sellerLocation.latitude,
                                longitude: sellerLocation.longitude
                            },
                            accuracy: sellerLocation.accuracy,
                            serviceable: sellerLocation.serviceable,
                            provider: 'mapbox',
                            location: seller.location || {},
                            shopInfo: seller.shopInfo || {}
                        });
                    }
                } catch (error) {
                    console.error(`[SELLER] Error fetching seller ${sellerId}:`, error);
                    // Continue with other sellers even if one fails
                }
            }

            responseReturn(res, 200, {
                message: 'Seller addresses retrieved successfully',
                sellerAddresses,
                count: sellerAddresses.length,
                provider: 'mapbox'
            });

        } catch (error) {
            console.error('[SELLER] Get seller addresses failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'SELLER_ADDRESS_FETCH_FAILED'
            });
        }
    }



    async handlePaymentSuccess(orderId, session) {
        const now = moment();
        const orderIdStr = orderId.toString();

        try {
            console.log(`[ORDER] Processing payment success for order: ${orderIdStr}`);

            const order = await customerOrder.findById(orderId)
                .session(session)
                .select('+price +payment_status +products')
                .lean();

            if (!order) {
                throw new Error(`Order ${orderIdStr} not found`);
            }

            if (order.payment_status === 'paid') {
                console.log(`[ORDER] Order ${orderIdStr} already paid, skipping`);
                return;
            }

            this.clearPaymentTimeout(orderIdStr);

            // Update main order
            await customerOrder.findByIdAndUpdate(
                orderId,
                {
                    $set: {
                        payment_status: 'paid',
                        delivery_status: 'pending',
                        paid_at: now.toDate()
                    }
                },
                { session }
            );

            // Update auth orders
            await authOrderModel.updateMany(
                { orderId },
                {
                    $set: {
                        payment_status: 'paid',
                        delivery_status: 'pending'
                    }
                },
                { session }
            );

            // Create Kwik deliveries with retry logic
            await this.createKwikDeliveriesWithRetry(orderId, session);

            // Create wallet entries
            const dateString = now.format('L').split('/');
            await myShopWallet.create([{
                amount: order.price,
                manth: dateString[0],
                year: dateString[2],
                orderId,
                createdAt: now.toDate()
            }], { session });

            // Create seller wallet entries
            const sellerOrders = await authOrderModel.find({ orderId }).session(session);
            await Promise.all(
                sellerOrders.map(sellerOrder =>
                    sellerWallet.create([{
                        sellerId: sellerOrder.sellerId,
                        amount: sellerOrder.price,
                        manth: dateString[0],
                        year: dateString[2],
                        orderId,
                        createdAt: now.toDate()
                    }], { session })
                )
            );

            console.log(`[ORDER] Payment success processing completed for order: ${orderIdStr}`);

        } catch (error) {
            console.error(`[ORDER] Payment success handling failed for ${orderIdStr}:`, error);
            throw error;
        }
    }


    clearPaymentTimeout(orderId) {
        const timeout = this.paymentTimeouts.get(orderId.toString());
        if (timeout) {
            clearTimeout(timeout);
            this.paymentTimeouts.delete(orderId.toString());
        }
    }

    async get_seller_phones(req, res) {
        try {
            const { sellerIds } = req.body;

            if (!sellerIds || !Array.isArray(sellerIds)) {
                return responseReturn(res, 400, {
                    error: 'sellerIds array is required'
                });
            }

            const sellerPhones = [];

            for (const sellerId of sellerIds) {
                try {
                    const seller = await sellerModel.findById(sellerId).select('name email phone shopInfo');

                    if (seller) {
                        sellerPhones.push({
                            sellerId: seller._id,
                            name: seller.name,
                            phone: seller.phone || '08000000000', // Default Nigerian number
                            email: seller.email,
                            shopName: seller.shopInfo?.shopName || seller.name
                        });
                    }
                } catch (error) {
                    console.error(`[SELLER] Error fetching seller ${sellerId}:`, error);
                    // Continue with other sellers even if one fails
                }
            }

            responseReturn(res, 200, {
                message: 'Seller phone numbers retrieved successfully',
                sellerPhones,
                count: sellerPhones.length
            });

        } catch (error) {
            console.error('[SELLER] Get seller phones failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'SELLER_PHONES_FETCH_FAILED'
            });
        }
    }

    async createKwikDeliveriesWithRetry(orderId, session, retryCount = 0) {
        try {
            await this.createKwikDeliveries(orderId, session);
        } catch (error) {
            if (retryCount < this.maxRetries) {
                console.warn(`[KWIK] Delivery creation failed, retrying (${retryCount + 1}/${this.maxRetries})...`);
                await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
                return this.createKwikDeliveriesWithRetry(orderId, session, retryCount + 1);
            } else {
                console.error(`[KWIK] All delivery creation retries failed for order: ${orderId}`);
                // Don't throw error - allow order to continue with standard delivery
            }
        }
    }

    async place_order(req, res) {
        const session = await mongoose.startSession();
        let order = null;

        try {
            session.startTransaction();

            const {
                price,
                products,
                shipping_fee,
                shippingInfo,
                userId
            } = req.body;

            // Enhanced validation with phone number
            if (!products || !Array.isArray(products) || products.length === 0) {
                throw new Error('Valid products array is required');
            }

            if (!shippingInfo?.address || !shippingInfo?.phone) {
                throw new Error('Complete shipping information including phone number is required');
            }

            // Validate phone number format
            const phoneRegex = /^(\+234|0)[789][01]\d{8}$/;
            if (!phoneRegex.test(shippingInfo.phone.replace(/\s/g, ''))) {
                throw new Error('Please provide a valid Nigerian phone number');
            }

            if (!userId) {
                throw new Error('User ID is required');
            }

            console.log(`[ORDER] Placing order for user: ${userId}`, {
                productCount: products.reduce((sum, seller) => sum + seller.products.length, 0),
                totalPrice: price + (shipping_fee || 0),
                customerPhone: shippingInfo.phone
            });

            // Use the coordinates provided from frontend Mapbox integration
            if (!shippingInfo.coordinates || !shippingInfo.coordinates.latitude || !shippingInfo.coordinates.longitude) {
                throw new Error('Address coordinates are required. Please use the location tools to verify your address.');
            }

            const tx_ref = this.generateTxRef();
            const totalPrice = parseFloat((price + (shipping_fee || 0)).toFixed(2));

            // Use the coordinates from frontend Mapbox integration
            const shippingCoordinates = shippingInfo.coordinates;

            // Create main order with enhanced geolocation data
            const [createdOrder] = await customerOrder.create([{
                customerId: new ObjectId(userId),
                shippingInfo: {
                    ...shippingInfo,
                    coordinates: {
                        latitude: shippingCoordinates.latitude,
                        longitude: shippingCoordinates.longitude
                    },
                    formattedAddress: shippingInfo.address,
                    validated: true,
                    serviceable: true, // Assuming serviceable since we got coordinates
                    accuracy: 'verified',
                    geocodingProvider: shippingInfo.geocodingSource || 'mapbox',
                    phone: shippingInfo.phone // Ensure phone is stored
                },
                products: products.flatMap(seller =>
                    seller.products.map(item => ({
                        productId: item.productInfo._id,
                        name: item.productInfo.name,
                        brand: item.productInfo.brand,
                        images: item.productInfo.images || [],
                        price: item.productInfo.price,
                        discount: item.productInfo.discount || 0,
                        quantity: item.quantity,
                        weight: item.productInfo.weight || 0.5,
                        length: item.productInfo.length || 10,
                        width: item.productInfo.width || 10,
                        height: item.productInfo.height || 10,
                        category: item.productInfo.category,
                        description: item.productInfo.description,
                        shopName: item.productInfo.shopName,
                        stock: item.productInfo.stock,
                        sellerId: seller.sellerId
                    }))
                ),
                price: totalPrice,
                currency: this.currency,
                delivery_status: 'pending',
                payment_status: 'unpaid',
                flutterwave_ref: tx_ref,
                address_validation: {
                    validated: true,
                    serviceable: true,
                    accuracy: 'verified',
                    provider: 'mapbox',
                    relevance: 'high',
                    coordinates: shippingCoordinates,
                    source: shippingInfo.geocodingSource || 'mapbox'
                },
                createdAt: new Date()
            }], { session });

            order = createdOrder;

            // Create seller orders with real-time seller addresses
            const authOrders = await Promise.all(
                products.map(async (seller) => {
                    if (!seller?.sellerId || !seller?.price) {
                        throw new Error('Invalid seller data');
                    }

                    const sellerLocation = await this.getSellerLocation(seller.sellerId);

                    return {
                        orderId: order._id,
                        sellerId: seller.sellerId,
                        shippingInfo: {
                            ...order.shippingInfo,
                            phone: shippingInfo.phone // Include customer phone
                        },
                        sellerAddress: {
                            address: sellerLocation.address,
                            coordinates: {
                                latitude: sellerLocation.latitude,
                                longitude: sellerLocation.longitude
                            },
                            phone: sellerLocation.phone,
                            email: sellerLocation.email,
                            name: sellerLocation.name,
                            shopName: sellerLocation.name,
                            serviceable: sellerLocation.serviceable,
                            validated: true,
                            accuracy: sellerLocation.accuracy,
                            provider: 'mapbox'
                        },
                        products: seller.products.map(item => ({
                            productId: item.productInfo._id,
                            name: item.productInfo.name,
                            brand: item.productInfo.brand,
                            images: item.productInfo.images,
                            price: item.productInfo.price,
                            discount: item.productInfo.discount,
                            quantity: item.quantity,
                            weight: item.productInfo.weight || 0.5,
                            length: item.productInfo.length || 10,
                            width: item.productInfo.width || 10,
                            height: item.productInfo.height || 10,
                            category: item.productInfo.category,
                            description: item.productInfo.description,
                            shopName: item.productInfo.shopName,
                            stock: item.productInfo.stock
                        })),
                        price: seller.price,
                        payment_status: 'unpaid',
                        delivery_status: 'pending',
                        address_validation: {
                            pickup_validated: sellerLocation.serviceable,
                            delivery_validated: true,
                            provider: 'mapbox',
                            accuracy: {
                                pickup: sellerLocation.accuracy,
                                delivery: 'verified'
                            }
                        },
                        createdAt: new Date()
                    };
                })
            );

            await authOrderModel.insertMany(authOrders, { session });

            // Clear cart items
            const cartIds = products.flatMap(seller =>
                seller.products.map(item => item._id).filter(Boolean)
            );
            if (cartIds.length > 0) {
                await cardModel.deleteMany({ _id: { $in: cartIds } }).session(session);
            }

            // Set payment timeout
            this.paymentTimeouts.set(
                order._id.toString(),
                setTimeout(async () => {
                    await this.handlePaymentTimeout(order._id);
                }, this.paymentTimeout)
            );

            await session.commitTransaction();

            console.log(`[ORDER] Order placed successfully: ${order._id}`, {
                shippingValidated: true,
                serviceable: true,
                accuracy: 'verified',
                provider: 'mapbox',
                customerPhone: shippingInfo.phone,
                coordinates: shippingCoordinates
            });

            responseReturn(res, 201, {
                message: 'Order placed successfully',
                orderId: order._id,
                tx_ref,
                totalAmount: totalPrice,
                address_validation: {
                    validated: true,
                    serviceable: true,
                    accuracy: 'verified',
                    provider: 'mapbox'
                },
                coordinates: shippingCoordinates,
                customerPhone: shippingInfo.phone
            });

        } catch (error) {
            await session.abortTransaction();
            console.error(`[ORDER] Order placement failed:`, error);
            responseReturn(res, 500, {
                message: error.message,
                code: 'ORDER_CREATION_FAILED'
            });
        } finally {
            session.endSession();
        }
    }


    async handlePaymentTimeout(orderId) {
        const timeoutSession = await mongoose.startSession();
        try {
            await timeoutSession.withTransaction(async () => {
                const updatedOrder = await customerOrder.findById(orderId);
                if (updatedOrder && updatedOrder.payment_status === 'unpaid') {
                    await customerOrder.findByIdAndUpdate(
                        orderId,
                        {
                            $set: {
                                payment_status: 'failed',
                                delivery_status: 'cancelled',
                                cancellation_reason: 'Payment timeout'
                            }
                        },
                        { session: timeoutSession }
                    );
                    await authOrderModel.updateMany(
                        { orderId },
                        {
                            $set: {
                                delivery_status: 'cancelled',
                                payment_status: 'failed'
                            }
                        },
                        { session: timeoutSession }
                    );
                    console.log(`[ORDER] Order ${orderId} cancelled due to payment timeout`);
                }
            });
        } catch (error) {
            console.error(`[ORDER] Payment timeout handling error for ${orderId}:`, error);
        } finally {
            timeoutSession.endSession();
            this.paymentTimeouts.delete(orderId.toString());
        }
    }

    // ==================== KWIK DELIVERY METHODS ====================

    async createKwikDeliveries(orderId, session) {
        try {
            console.log(`[KWIK] Creating enhanced deliveries with product data for order: ${orderId}`);

            const sellerOrders = await authOrderModel.find({ orderId }).session(session);
            let successfulDeliveries = 0;
            let failedDeliveries = 0;

            for (const sellerOrder of sellerOrders) {
                try {
                    const seller = await sellerModel.findById(sellerOrder.sellerId);
                    if (!seller) {
                        console.warn(`[KWIK] Seller not found: ${sellerOrder.sellerId}`);
                        failedDeliveries++;
                        continue;
                    }

                    const sellerLocation = sellerOrder.sellerAddress;
                    const customerLocation = sellerOrder.shippingInfo;

                    // Calculate package details using ACTUAL product data from the order
                    const packageDetails = await this.calculateEnhancedPackageDetails(sellerOrder.products);

                    console.log(`[KWIK] Package details for seller ${seller.name}:`, {
                        weight: packageDetails.weight,
                        dimensions: packageDetails.dimensions,
                        itemCount: packageDetails.itemCount,
                        actualWeight: packageDetails.actualWeight,
                        dimensionalWeight: packageDetails.dimensionalWeight
                    });

                    // Enhanced delivery data with real product information
                    const deliveryData = {
                        pickup: {
                            address: sellerLocation.address,
                            latitude: sellerLocation.coordinates.latitude,
                            longitude: sellerLocation.coordinates.longitude,
                            name: sellerLocation.name,
                            phone: sellerLocation.phone,
                            email: sellerLocation.email,
                            time: new Date().toISOString().replace('T', ' ').substring(0, 19)
                        },
                        delivery: {
                            address: customerLocation.address,
                            latitude: customerLocation.coordinates.latitude,
                            longitude: customerLocation.coordinates.longitude,
                            name: customerLocation.name,
                            phone: customerLocation.phone,
                            email: customerLocation.email,
                            time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19)
                        },
                        amount: "1000", // Will be updated by bill breakdown
                        vehicleId: this.determineEnhancedVehicleId(packageDetails.weight, packageDetails.dimensions),
                        isInsured: true,
                        isCOD: sellerOrder.payment_status === 'unpaid',
                        instructions: `Order ${orderId} - ${packageDetails.itemCount} items - Handle with care`,
                        autoAssign: true,
                        package: {
                            weight: packageDetails.weight,
                            length: packageDetails.dimensions.length,
                            width: packageDetails.dimensions.width,
                            height: packageDetails.dimensions.height,
                            item_count: packageDetails.itemCount,
                            actual_weight: packageDetails.actualWeight,
                            dimensional_weight: packageDetails.dimensionalWeight
                        }
                    };

                    // Get accurate pricing with enhanced package details
                    const feeResult = await KwikService.getEnhancedBillBreakdown(
                        deliveryData.pickup,
                        deliveryData.delivery,
                        {
                            vehicleId: deliveryData.vehicleId,
                            weight: packageDetails.weight,
                            dimensions: packageDetails.dimensions,
                            itemCount: packageDetails.itemCount,
                            isInsured: true,
                            isCOD: sellerOrder.payment_status === 'unpaid',
                            parcel_amount: sellerOrder.price,
                            instructions: deliveryData.instructions
                        }
                    );

                    if (feeResult.success) {
                        deliveryData.amount = feeResult.fee.toString();
                    }

                    const kwikResult = await KwikService.createDeliveryTask(deliveryData);

                    if (kwikResult.success) {
                        sellerOrder.delivery = {
                            provider: 'kwik',
                            kwikOrderId: kwikResult.orderId,
                            kwikVendorId: kwikResult.vendor_id,
                            trackingNumber: kwikResult.jobDetails?.pickups?.[0]?.job_hash,
                            trackingUrl: kwikResult.jobDetails?.pickups?.[0]?.result_tracking_link,
                            fee: kwikResult.jobDetails?.amount || feeResult.fee,
                            status: 'pending',
                            package: deliveryData.package,
                            coordinates: kwikResult.coordinates,
                            created_at: new Date(),
                            history: [{
                                event: 'created',
                                timestamp: new Date(),
                                status: 'pending',
                                coordinates: kwikResult.coordinates
                            }],
                            phone_numbers: {
                                seller: sellerLocation.phone,
                                customer: customerLocation.phone
                            }
                        };
                        sellerOrder.delivery_status = 'processing';

                        await sellerOrder.save({ session });
                        successfulDeliveries++;

                        console.log(`[KWIK] Enhanced delivery created for seller ${seller.name}`, {
                            weight: packageDetails.weight,
                            dimensions: packageDetails.dimensions,
                            vehicle: deliveryData.vehicleId,
                            fee: deliveryData.amount
                        });
                    } else {
                        throw new Error(kwikResult.error);
                    }
                } catch (error) {
                    console.error(`[KWIK] Enhanced delivery creation failed for seller ${sellerOrder.sellerId}:`, error);
                    failedDeliveries++;
                }
            }

            console.log(`[KWIK] Enhanced delivery creation completed for order ${orderId}`, {
                successful: successfulDeliveries,
                failed: failedDeliveries
            });

        } catch (error) {
            console.error(`[KWIK] Error in enhanced createKwikDeliveries for order ${orderId}:`, error);
        }
    }

    async calculatePackageDetails(products) {
        let totalWeight = 0;
        let totalVolume = 0;
        let maxLength = 0;
        let maxWidth = 0;
        let maxHeight = 0;
        let totalItems = 0;

        for (const product of products) {
            // Use ACTUAL product data from the database
            const weight = product.weight || 0.5;
            const length = product.length || 10;
            const width = product.width || 10;
            const height = product.height || 10;
            const quantity = product.quantity;

            totalWeight += weight * quantity;
            totalVolume += length * width * height * quantity;

            maxLength = Math.max(maxLength, length);
            maxWidth = Math.max(maxWidth, width);
            maxHeight = Math.max(maxHeight, height);
            totalItems += quantity;
        }

        const dimensionalWeight = totalVolume / 5000; // Standard dimensional weight calculation

        return {
            weight: Math.max(totalWeight, dimensionalWeight),
            volume: totalVolume,
            dimensions: {
                length: maxLength,
                width: maxWidth,
                height: maxHeight
            },
            itemCount: totalItems,
            actualWeight: totalWeight,
            dimensionalWeight: dimensionalWeight
        };
    }

    // Enhanced vehicle determination
    determineVehicleId(weight, dimensions) {
        const volume = dimensions.length * dimensions.width * dimensions.height;

        // Consider both weight and volume for vehicle selection
        if (weight > 25 || volume > 1500000) return 3; // Large van
        if (weight > 15 || volume > 800000) return 2;  // Medium van
        if (weight > 5 || volume > 200000) return 1;   // Small van
        return 0; // Bike
    }

    // ==================== PICKUP INTEGRATION METHODS ====================

    async create_pickup_only(req, res) {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const {
                    pickup,
                    amount,
                    vehicleId,
                    instructions,
                    loadersCount,
                    isInsured,
                    template_data,
                    ref_images
                } = req.body;

                const sellerId = req.sellerId;

                if (!pickup?.address) {
                    throw new Error('Pickup address is required');
                }

                const sellerLocation = await this.getSellerLocation(sellerId);

                // Use Kwik geolocation
                const coordinates = await KwikService.getCoordinatesFromAddress(pickup.address);
                if (!coordinates.success) {
                    throw new Error(`Geolocation failed: ${coordinates.error}`);
                }

                const pickupData = {
                    pickup: {
                        address: pickup.address,
                        name: pickup.name || sellerLocation.name,
                        latitude: coordinates.latitude || pickup.latitude,
                        longitude: coordinates.longitude || pickup.longitude,
                        phone: pickup.phone || sellerLocation.phone,
                        email: pickup.email || sellerLocation.email,
                        time: pickup.time || new Date().toISOString().replace('T', ' ').substring(0, 19)
                    },
                    amount: amount || "500",
                    vehicleId: vehicleId || 1,
                    instructions: instructions || `Pickup from ${sellerLocation.name}`,
                    loadersCount: loadersCount || 0,
                    loadersRequired: loadersCount > 0,
                    isInsured: isInsured || false,
                    autoAssign: true,
                    template_data: template_data || [],
                    ref_images: ref_images || ""
                };

                const kwikResult = await KwikService.createPickupTask(pickupData);

                if (!kwikResult.success) {
                    throw new Error(`Kwik pickup creation failed: ${kwikResult.error}`);
                }

                // Create pickup record
                const [pickupRecord] = await authOrderModel.create([{
                    sellerId: sellerId,
                    orderType: 'pickup_only',
                    pickupInfo: pickupData.pickup,
                    delivery: {
                        provider: 'kwik',
                        kwikOrderId: kwikResult.orderId,
                        pickup_job_id: kwikResult.pickup_job_id,
                        trackingNumber: kwikResult.pickup_hash,
                        trackingUrl: kwikResult.tracking_link,
                        fee: parseFloat(amount) || 500,
                        status: 'pending',
                        instructions: instructions,
                        created_at: new Date(),
                        history: [{
                            event: 'pickup_created',
                            timestamp: new Date(),
                            status: 'pending'
                        }]
                    },
                    price: parseFloat(amount) || 500,
                    payment_status: 'paid',
                    delivery_status: 'processing',
                    createdAt: new Date()
                }], { session });

                responseReturn(res, 200, {
                    message: 'Pickup task created successfully',
                    pickupId: pickupRecord._id,
                    kwikOrderId: kwikResult.orderId,
                    trackingUrl: kwikResult.tracking_link,
                    pickup_job_id: kwikResult.pickup_job_id,
                    estimatedFee: amount
                });
            });
        } catch (error) {
            console.error('[PICKUP] Create pickup failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'PICKUP_CREATION_FAILED'
            });
        } finally {
            session.endSession();
        }
    }

    async schedule_pickup(req, res) {
        try {
            const {
                pickup,
                delivery,
                scheduleTime,
                vehicleId,
                instructions,
                isReturnTask
            } = req.body;

            const sellerId = req.sellerId;

            if (!scheduleTime) {
                throw new Error('Schedule time is required');
            }

            const sellerLocation = await this.getSellerLocation(sellerId);

            // Validate and geocode addresses
            const pickupCoords = await KwikService.getCoordinatesFromAddress(pickup.address);
            const deliveryCoords = await KwikService.getCoordinatesFromAddress(delivery.address);

            if (!pickupCoords.success || !deliveryCoords.success) {
                throw new Error('Address validation failed');
            }

            const scheduledData = {
                pickup: {
                    address: pickup.address,
                    name: pickup.name || sellerLocation.name,
                    latitude: pickupCoords.latitude || pickup.latitude,
                    longitude: pickupCoords.longitude || pickup.longitude,
                    phone: pickup.phone || sellerLocation.phone,
                    email: pickup.email || sellerLocation.email,
                    time: scheduleTime
                },
                delivery: {
                    address: delivery.address,
                    name: delivery.name,
                    latitude: deliveryCoords.latitude || delivery.latitude,
                    longitude: deliveryCoords.longitude || delivery.longitude,
                    phone: delivery.phone,
                    email: delivery.email,
                    time: new Date(new Date(scheduleTime).getTime() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19),
                    has_return_task: isReturnTask || false
                },
                amount: "1000",
                vehicleId: vehicleId || 1,
                instructions: instructions || `Scheduled pickup and delivery`,
                autoAssign: true,
                isScheduled: true,
                scheduleStart: scheduleTime,
                scheduleEnd: new Date(new Date(scheduleTime).getTime() + 24 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19)
            };

            // Get accurate pricing
            const billResult = await KwikService.getBillBreakdown(
                scheduledData.pickup,
                scheduledData.delivery,
                {
                    vehicleId: vehicleId,
                    weight: 2,
                    isInsured: true
                }
            );

            if (billResult.success) {
                scheduledData.amount = billResult.fee.toString();
            }

            const kwikResult = await KwikService.createDeliveryTask(scheduledData);

            if (kwikResult.success) {
                responseReturn(res, 200, {
                    message: 'Scheduled pickup and delivery created successfully',
                    kwikOrderId: kwikResult.orderId,
                    trackingLinks: kwikResult.trackingLinks,
                    scheduledAmount: scheduledData.amount,
                    scheduledTime: scheduleTime,
                    estimatedDelivery: new Date(new Date(scheduleTime).getTime() + 2 * 60 * 60 * 1000)
                });
            } else {
                throw new Error(kwikResult.error);
            }
        } catch (error) {
            console.error('[SCHEDULE] Schedule pickup failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'SCHEDULE_CREATION_FAILED'
            });
        }
    }

    // ==================== ADDRESS & VALIDATION METHODS ====================

    async validate_address(req, res) {
        try {
            const { address } = req.body;

            if (!address) {
                return responseReturn(res, 400, { error: 'Address is required' });
            }

            // Use Mapbox for real-time validation
            const validation = await MapboxService.validateAddress(address);

            if (validation.valid) {
                responseReturn(res, 200, {
                    valid: true,
                    address: validation.address,
                    coordinates: validation.coordinates,
                    serviceable: validation.serviceable,
                    accuracy: validation.accuracy,
                    relevance: validation.relevance,
                    provider: 'mapbox',
                    note: validation.note
                });
            } else {
                responseReturn(res, 200, {
                    valid: false,
                    error: validation.error,
                    serviceable: false,
                    provider: 'mapbox'
                });
            }
        } catch (error) {
            console.error('[VALIDATION] Address validation failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                provider: 'mapbox'
            });
        }
    }


    async mapbox_geocode(req, res) {
        try {
            const { address } = req.body;

            if (!address) {
                return responseReturn(res, 400, {
                    error: 'Address is required',
                    code: 'ADDRESS_REQUIRED'
                });
            }

            console.log(`[MAPBOX] Geocoding address: ${address.substring(0, 100)}`);

            const result = await MapboxService.geocodeAddress(address);

            if (result.success) {
                responseReturn(res, 200, {
                    success: true,
                    coordinates: {
                        latitude: result.latitude,
                        longitude: result.longitude
                    },
                    formattedAddress: result.formattedAddress,
                    relevance: result.relevance,
                    accuracy: result.accuracy,
                    placeType: result.placeType,
                    serviceable: await MapboxService.isAddressServiceable(result.latitude, result.longitude, result.accuracy),
                    cached: result.cached || false,
                    provider: 'mapbox'
                });
            } else {
                responseReturn(res, 400, {
                    success: false,
                    error: result.error,
                    query: address,
                    provider: 'mapbox'
                });
            }
        } catch (error) {
            console.error('[MAPBOX] Geocoding failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'GEOCODING_FAILED',
                provider: 'mapbox'
            });
        }
    }

    async mapbox_reverse_geocode(req, res) {
        try {
            const { latitude, longitude } = req.body;

            if (latitude === undefined || longitude === undefined) {
                return responseReturn(res, 400, {
                    error: 'Latitude and longitude are required',
                    code: 'COORDINATES_REQUIRED'
                });
            }

            console.log(`[MAPBOX] Reverse geocoding coordinates: ${latitude}, ${longitude}`);

            const result = await MapboxService.reverseGeocode(latitude, longitude);

            if (result.success) {
                responseReturn(res, 200, {
                    success: true,
                    address: result.formattedAddress,
                    coordinates: { latitude, longitude },
                    relevance: result.relevance,
                    accuracy: result.accuracy,
                    placeType: result.placeType,
                    cached: result.cached || false,
                    provider: 'mapbox'
                });
            } else {
                responseReturn(res, 400, {
                    success: false,
                    error: result.error,
                    provider: 'mapbox'
                });
            }
        } catch (error) {
            console.error('[MAPBOX] Reverse geocoding failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'REVERSE_GEOCODING_FAILED',
                provider: 'mapbox'
            });
        }
    }

    async mapbox_validate_address(req, res) {
        try {
            const { address } = req.body;

            if (!address) {
                return responseReturn(res, 400, {
                    error: 'Address is required',
                    code: 'ADDRESS_REQUIRED'
                });
            }

            console.log(`[MAPBOX] Validating address: ${address.substring(0, 100)}`);

            const result = await MapboxService.validateAddress(address);

            responseReturn(res, 200, {
                ...result,
                provider: 'mapbox',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[MAPBOX] Address validation failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'VALIDATION_FAILED',
                provider: 'mapbox'
            });
        }
    }

    async mapbox_calculate_route(req, res) {
        try {
            const { origin, destination, profile = 'driving' } = req.body;

            if (!origin?.address || !destination?.address) {
                return responseReturn(res, 400, {
                    error: 'Origin and destination addresses are required',
                    code: 'ADDRESSES_REQUIRED'
                });
            }

            console.log(`[MAPBOX] Calculating route from ${origin.address.substring(0, 50)} to ${destination.address.substring(0, 50)}`);

            // Geocode both addresses in parallel
            const [originGeocode, destinationGeocode] = await Promise.all([
                MapboxService.geocodeAddress(origin.address),
                MapboxService.geocodeAddress(destination.address)
            ]);

            if (!originGeocode.success || !destinationGeocode.success) {
                return responseReturn(res, 400, {
                    error: `Geocoding failed: Origin - ${originGeocode.error}, Destination - ${destinationGeocode.error}`,
                    code: 'GEOCODING_FAILED'
                });
            }

            // Calculate route using real coordinates
            const routeResult = await MapboxService.calculateRoute(
                {
                    latitude: originGeocode.latitude,
                    longitude: originGeocode.longitude
                },
                {
                    latitude: destinationGeocode.latitude,
                    longitude: destinationGeocode.longitude
                },
                profile
            );

            if (routeResult.success) {
                const deliveryTime = MapboxService.estimateDeliveryTime(routeResult.distance, profile);

                responseReturn(res, 200, {
                    success: true,
                    distance: {
                        meters: routeResult.distance,
                        kilometers: (routeResult.distance / 1000).toFixed(2),
                        text: `${(routeResult.distance / 1000).toFixed(2)} km`
                    },
                    duration: {
                        seconds: routeResult.duration,
                        minutes: Math.round(routeResult.duration / 60),
                        text: `${Math.round(routeResult.duration / 60)} min`
                    },
                    coordinates: {
                        origin: {
                            latitude: originGeocode.latitude,
                            longitude: originGeocode.longitude,
                            address: originGeocode.formattedAddress
                        },
                        destination: {
                            latitude: destinationGeocode.latitude,
                            longitude: destinationGeocode.longitude,
                            address: destinationGeocode.formattedAddress
                        }
                    },
                    estimatedDelivery: deliveryTime,
                    serviceable: true,
                    provider: 'mapbox'
                });
            } else {
                responseReturn(res, 400, {
                    success: false,
                    error: routeResult.error,
                    provider: 'mapbox'
                });
            }
        } catch (error) {
            console.error('[MAPBOX] Route calculation failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'ROUTE_CALCULATION_FAILED',
                provider: 'mapbox'
            });
        }
    }

    async mapbox_batch_geocode(req, res) {
        try {
            const { addresses } = req.body;

            if (!addresses || !Array.isArray(addresses)) {
                return responseReturn(res, 400, {
                    error: 'Addresses array is required',
                    code: 'ADDRESSES_ARRAY_REQUIRED'
                });
            }

            if (addresses.length > 50) {
                return responseReturn(res, 400, {
                    error: 'Maximum 50 addresses allowed per batch',
                    code: 'BATCH_LIMIT_EXCEEDED'
                });
            }

            console.log(`[MAPBOX] Batch geocoding ${addresses.length} addresses`);

            const result = await MapboxService.batchGeocode(addresses);

            responseReturn(res, 200, {
                ...result,
                provider: 'mapbox',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[MAPBOX] Batch geocoding failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'BATCH_GEOCODING_FAILED',
                provider: 'mapbox'
            });
        }
    }

    async mapbox_health_check(req, res) {
        try {
            const health = await MapboxService.healthCheck();

            responseReturn(res, 200, {
                ...health,
                provider: 'mapbox',
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[MAPBOX] Health check failed:', error);
            responseReturn(res, 500, {
                healthy: false,
                error: error.message,
                provider: 'mapbox',
                timestamp: new Date().toISOString()
            });
        }
    }


    async getAddressCoordinates(address) {
        try {
            console.log(`[MAPBOX] Getting real-time coordinates for: ${address.substring(0, 100)}`);

            const result = await MapboxService.geocodeAddress(address);

            if (result.success) {
                return {
                    latitude: result.latitude,
                    longitude: result.longitude,
                    formattedAddress: result.formattedAddress,
                    accuracy: result.accuracy,
                    relevance: result.relevance,
                    serviceable: await MapboxService.isAddressServiceable(result.latitude, result.longitude, result.accuracy),
                    provider: 'mapbox',
                    cached: result.cached || false
                };
            } else {
                throw new Error(`Mapbox geocoding failed: ${result.error}`);
            }
        } catch (error) {
            console.error('[MAPBOX] Get coordinates failed:', error);
            throw new Error(`Unable to geocode address: ${error.message}`);
        }
    }

    // ==================== SELLER LOCATION MANAGEMENT ====================

    async getSellerLocation(sellerId) {
        try {
            const seller = await sellerModel.findById(sellerId);
            if (!seller) {
                throw new Error('Seller not found');
            }

            // Build address from seller location data
            const addressParts = [];
            if (seller.location?.address) addressParts.push(seller.location.address);
            if (seller.shopInfo?.sub_district) addressParts.push(seller.shopInfo.sub_district);
            if (seller.shopInfo?.district) addressParts.push(seller.shopInfo.district);
            if (seller.shopInfo?.division) addressParts.push(seller.shopInfo.division);

            const fullAddress = addressParts.length > 0
                ? addressParts.join(', ')
                : 'Lagos, Nigeria';

            console.log(`[SELLER] Original address from DB: ${fullAddress}`);

            // Get coordinates from Mapbox
            const coordinates = await this.getAddressCoordinates(fullAddress);

            console.log(`[SELLER] After geocoding: ${coordinates.formattedAddress}`);

            return {
                address: fullAddress, // USE ORIGINAL ADDRESS
                name: seller.shopInfo?.shopName || seller.name,
                phone: seller.phone || "08000000000",
                email: seller.email,
                latitude: coordinates.latitude,
                longitude: coordinates.longitude,
                accuracy: coordinates.accuracy,
                serviceable: coordinates.serviceable,
                provider: coordinates.provider,
                sellerId: sellerId,
                originalAddress: fullAddress
            };

        } catch (error) {
            console.error('[SELLER] Get seller location failed:', error);
            // Return fallback location
            return {
                address: "Lagos, Nigeria",
                name: "Seller",
                phone: "08000000000",
                email: "seller@example.com",
                latitude: 6.5244,
                longitude: 3.3792,
                accuracy: 'fallback_error',
                serviceable: true,
                requiresGeocoding: true
            };
        }
    }

    // ==================== KWIK RESOURCE METHODS ====================

    async get_kwik_vehicles(req, res) {
        try {
            const { size } = req.query;

            const result = await KwikService.getVehicleOptions(parseInt(size) || 0);

            if (result.success) {
                responseReturn(res, 200, {
                    vehicles: result.vehicles,
                    message: result.message
                });
            } else {
                responseReturn(res, 400, { error: result.error });
            }
        } catch (error) {
            console.error('[KWIK] Get vehicles failed:', error);
            responseReturn(res, 500, { error: error.message });
        }
    }

    async get_kwik_loaders(req, res) {
        try {
            const result = await KwikService.getLoaderOptions();

            if (result.success) {
                responseReturn(res, 200, {
                    loaders: result.loaders,
                    is_enabled: result.is_loaders_enabled,
                    message: result.message
                });
            } else {
                responseReturn(res, 400, { error: result.error });
            }
        } catch (error) {
            console.error('[KWIK] Get loaders failed:', error);
            responseReturn(res, 500, { error: error.message });
        }
    }

    async kwik_health_check(req, res) {
        try {
            const health = await KwikService.healthCheck();

            responseReturn(res, 200, {
                ...health,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[KWIK] Health check failed:', error);
            responseReturn(res, 500, {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    // ==================== EXISTING ORDER METHODS (Optimized) ====================

    async accept_order_with_kwik(req, res) {
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const { orderId } = req.params;
                const { vehicleId, isInsured, instructions, loadersCount } = req.body;
                const sellerId = req.sellerId;

                const order = await authOrderModel.findById(orderId).session(session);
                if (!order) {
                    throw new Error('Order not found');
                }

                if (order.delivery?.provider === 'kwik') {
                    throw new Error('Order already has Kwik delivery');
                }

                const sellerLocation = await this.getSellerLocation(sellerId);
                const packageDetails = await this.calculatePackageDetails(order.products);

                const kwikResult = await KwikService.createDeliveryTask({
                    pickup: {
                        address: sellerLocation.address,
                        latitude: sellerLocation.latitude,
                        longitude: sellerLocation.longitude,
                        name: sellerLocation.name,
                        phone: sellerLocation.phone,
                        email: sellerLocation.email,
                        time: new Date().toISOString().replace('T', ' ').substring(0, 19)
                    },
                    delivery: {
                        address: order.shippingInfo.address,
                        latitude: order.shippingInfo.latitude,
                        longitude: order.shippingInfo.longitude,
                        name: order.shippingInfo.name,
                        phone: order.shippingInfo.phone,
                        email: order.shippingInfo.email,
                        time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19)
                    },
                    amount: order.price,
                    vehicleId: vehicleId || 1,
                    isInsured: isInsured !== false,
                    isCOD: order.payment_status === 'unpaid',
                    instructions: instructions || `Order ${orderId}`,
                    loadersCount: loadersCount || 0,
                    autoAssign: true,
                    package: {
                        weight: packageDetails.weight,
                        length: packageDetails.dimensions.length,
                        width: packageDetails.dimensions.width,
                        height: packageDetails.dimensions.height,
                        item_count: packageDetails.itemCount
                    }
                });

                if (!kwikResult.success) {
                    throw new Error(kwikResult.error);
                }

                order.delivery = {
                    provider: 'kwik',
                    kwikOrderId: kwikResult.orderId,
                    kwikVendorId: kwikResult.vendor_id,
                    trackingNumber: kwikResult.jobDetails?.pickups?.[0]?.job_hash,
                    trackingUrl: kwikResult.jobDetails?.pickups?.[0]?.result_tracking_link,
                    fee: kwikResult.jobDetails?.amount || 0,
                    status: 'pending',
                    rider: null,
                    package: {
                        weight: packageDetails.weight,
                        length: packageDetails.dimensions.length,
                        width: packageDetails.dimensions.width,
                        height: packageDetails.dimensions.height,
                        item_count: packageDetails.itemCount
                    },
                    history: [{
                        event: 'accepted_by_seller',
                        timestamp: new Date(),
                        status: 'pending'
                    }]
                };

                order.delivery_status = 'accepted';
                await order.save({ session });

                responseReturn(res, 200, {
                    message: 'Order accepted with Kwik delivery',
                    trackingId: kwikResult.orderId,
                    trackingUrl: kwikResult.jobDetails?.pickups?.[0]?.result_tracking_link,
                    kwikOrderId: kwikResult.orderId,
                    kwikVendorId: kwikResult.vendor_id,
                    estimatedFee: kwikResult.jobDetails?.amount,
                    package: packageDetails
                });
            });
        } catch (error) {
            console.error('[KWIK] Accept order failed:', error);
            responseReturn(res, 500, { error: error.message });
        } finally {
            session.endSession();
        }
    }

    async track_delivery(req, res) {
        try {
            const { orderId } = req.params;

            const order = await authOrderModel.findById(orderId);
            if (!order || !order.delivery || order.delivery.provider !== 'kwik') {
                return responseReturn(res, 404, { error: 'Kwik delivery not found for this order' });
            }

            const trackingResult = await KwikService.trackDelivery(order.delivery.kwikOrderId);

            if (trackingResult.success) {
                // Update order status if needed
                if (trackingResult.status && trackingResult.status !== order.delivery.status) {
                    order.delivery.status = trackingResult.status;
                    order.delivery.history = order.delivery.history || [];
                    order.delivery.history.push({
                        event: 'status_update',
                        timestamp: new Date(),
                        status: trackingResult.status,
                        details: trackingResult.details
                    });

                    // Update main delivery status based on Kwik status
                    if (trackingResult.status === 'delivered') {
                        order.delivery_status = 'delivered';
                    } else if (trackingResult.status === 'cancelled') {
                        order.delivery_status = 'cancelled';
                    } else if (['accepted', 'picked_up', 'in_transit'].includes(trackingResult.status)) {
                        order.delivery_status = 'processing';
                    }

                    await order.save();
                }

                return responseReturn(res, 200, {
                    status: trackingResult.status,
                    trackingId: trackingResult.trackingId,
                    details: trackingResult,
                    orderStatus: order.delivery_status
                });
            } else {
                return responseReturn(res, 400, { error: trackingResult.error });
            }
        } catch (error) {
            console.error('[TRACKING] Track delivery failed:', error);
            return responseReturn(res, 500, { error: error.message });
        }
    }

    async cancel_kwik_delivery(req, res) {
        try {
            const { orderId } = req.params;

            const order = await authOrderModel.findById(orderId);
            if (!order || !order.delivery || order.delivery.provider !== 'kwik') {
                return responseReturn(res, 404, { error: 'Kwik delivery not found for this order' });
            }

            const result = await KwikService.cancelDelivery(order.delivery.kwikOrderId);

            if (result.success) {
                order.delivery.status = 'cancelled';
                order.delivery_status = 'cancelled';
                order.delivery.history = order.delivery.history || [];
                order.delivery.history.push({
                    event: 'cancelled',
                    timestamp: new Date(),
                    status: 'cancelled',
                    reason: 'Cancelled by seller'
                });
                await order.save();

                return responseReturn(res, 200, {
                    message: 'Kwik delivery cancelled successfully',
                    data: result.data
                });
            } else {
                return responseReturn(res, 400, { error: result.error });
            }
        } catch (error) {
            console.error('[CANCEL] Cancel Kwik delivery failed:', error);
            return responseReturn(res, 500, { error: error.message });
        }
    }

    async kwik_webhook(req, res) {
        try {
            // Verify webhook signature if provided by Kwik
            const signature = req.headers['x-kwik-signature'];
            // Implement signature verification if needed

            const event = req.body;
            console.log('[KWIK] Webhook received:', event);

            // Find order by tracking number or reference
            const order = await authOrderModel.findOne({
                'delivery.trackingNumber': event.tracking_number
            });

            if (!order) {
                console.warn('[KWIK] Webhook order not found:', event.tracking_number);
                return responseReturn(res, 404, { error: 'Order not found' });
            }

            let statusChanged = false;

            switch (event.event_type) {
                case 'job_created':
                    order.delivery.status = 'created';
                    break;
                case 'job_accepted':
                    order.delivery.status = 'accepted';
                    break;
                case 'job_picked_up':
                    order.delivery.status = 'picked_up';
                    order.delivery_status = 'in_transit';
                    statusChanged = true;
                    break;
                case 'job_in_transit':
                    order.delivery.status = 'in_transit';
                    break;
                case 'job_delivered':
                    order.delivery.status = 'delivered';
                    order.delivery_status = 'delivered';
                    statusChanged = true;
                    break;
                case 'job_cancelled':
                    order.delivery.status = 'cancelled';
                    order.delivery_status = 'cancelled';
                    statusChanged = true;
                    break;
            }

            // Add to delivery history
            order.delivery.history = order.delivery.history || [];
            order.delivery.history.push({
                event: event.event_type,
                timestamp: new Date(),
                data: event
            });

            await order.save();

            // Notify relevant parties if status changed
            if (statusChanged) {
                await this.notifyOrderUpdate(order);
            }

            console.log('[KWIK] Webhook processed successfully');
            responseReturn(res, 200, { message: 'Webhook processed successfully' });
        } catch (error) {
            console.error('[KWIK] Webhook processing failed:', error);
            responseReturn(res, 500, { error: error.message });
        }
    }

    async notifyOrderUpdate(order) {
        // Implement your notification logic (email, push notification, etc.)
        console.log(`[NOTIFICATION] Order ${order._id} status updated to: ${order.delivery_status}`);

        // Example: Send to connected sockets
        const io = req.app.get('io');
        if (io) {
            io.to(`order_${order._id}`).emit('order_updated', {
                orderId: order._id,
                status: order.delivery_status,
                deliveryStatus: order.delivery?.status,
                timestamp: new Date()
            });
        }
    }

    async test_kwik_integration(req, res) {
        try {
            console.log('[TEST] Testing Kwik integration...');

            // Test authentication
            const vendor = await KwikService.authenticate();
            if (!vendor.success) {
                throw new Error(`Authentication failed: ${vendor.error}`);
            }

            // Test getting vehicles
            const vehicles = await KwikService.getVehicleOptions();
            if (!vehicles.success) {
                throw new Error(`Vehicles fetch failed: ${vehicles.error}`);
            }

            // Test getting loaders
            const loaders = await KwikService.getLoaderOptions();
            if (!loaders.success) {
                throw new Error(`Loaders fetch failed: ${loaders.error}`);
            }

            // Test bill breakdown
            const feeResult = await KwikService.getBillBreakdown(
                {
                    address: "123 Test Address, Lagos, Nigeria",
                    latitude: 6.5244,
                    longitude: 3.3792,
                    name: "Test Seller",
                    phone: "08012345678",
                    email: "test@seller.com"
                },
                {
                    address: "456 Test Address, Lagos, Nigeria",
                    latitude: 6.6018,
                    longitude: 3.3515,
                    name: "Test Customer",
                    phone: "08087654321",
                    email: "test@customer.com"
                },
                {
                    vehicleId: 1,
                    weight: 2.5,
                    isInsured: true
                }
            );

            responseReturn(res, 200, {
                success: true,
                message: 'Kwik integration test successful!',
                vendor_id: vendor.vendor_id,
                vehicles_count: vehicles.vehicles?.length || 0,
                loaders_count: loaders.loaders?.length || 0,
                fee_calculation: feeResult.success ? `₦${feeResult.fee}` : 'Failed',
                fee_details: feeResult.success ? feeResult.breakdown : null
            });

        } catch (error) {
            console.error('[TEST] Kwik test failed:', error);
            responseReturn(res, 500, {
                success: false,
                error: error.message
            });
        }
    }

    // ==================== EXISTING CUSTOMER METHODS ====================

    async get_customer_databorad_data(req, res) {
        const { userId } = req.params;
        try {
            const recentOrders = await customerOrder.find({ customerId: new ObjectId(userId) })
                .limit(5)
                .sort({ createdAt: -1 });

            const counts = await Promise.all([
                customerOrder.countDocuments({ customerId: new ObjectId(userId), delivery_status: 'pending' }),
                customerOrder.countDocuments({ customerId: new ObjectId(userId) }),
                customerOrder.countDocuments({ customerId: new ObjectId(userId), delivery_status: 'cancelled' })
            ]);

            responseReturn(res, 200, {
                recentOrders,
                pendingOrder: counts[0],
                totalOrder: counts[1],
                cancelledOrder: counts[2]
            });
        } catch (error) {
            console.error('[CUSTOMER] Get dashboard data failed:', error);
            responseReturn(res, 500, { message: 'Server error' });
        }
    }

    async get_orders(req, res) {
        const { customerId, status } = req.params;
        try {
            const query = { customerId: new ObjectId(customerId) };
            if (status !== 'all') query.delivery_status = status;

            const orders = await customerOrder.find(query)
                .sort({ createdAt: -1 });

            responseReturn(res, 200, { orders });
        } catch (error) {
            console.error('[CUSTOMER] Get orders failed:', error);
            responseReturn(res, 500, { message: 'Server error' });
        }
    }

    async get_order(req, res) {
        const { orderId } = req.params;
        try {
            const order = await customerOrder.findById(orderId)
                .populate({
                    path: 'products.productId',
                    select: 'name brand images price weight length width height category description shopName stock discount'
                });

            if (!order) return responseReturn(res, 404, { message: 'Order not found' });

            const formattedOrder = {
                ...order._doc,
                products: order.products.map(p => ({
                    ...p._doc,
                    name: p.name || p.productId?.name,
                    brand: p.brand || p.productId?.brand,
                    images: p.images || p.productId?.images || [],
                    weight: p.weight || p.productId?.weight,
                    length: p.length || p.productId?.length,
                    width: p.width || p.productId?.width,
                    height: p.height || p.productId?.height,
                    category: p.category || p.productId?.category,
                    description: p.description || p.productId?.description,
                    shopName: p.shopName || p.productId?.shopName,
                    stock: p.stock || p.productId?.stock,
                    price: p.price || p.productId?.price,
                    discount: p.discount || p.productId?.discount,
                    quantity: p.quantity
                }))
            };

            responseReturn(res, 200, { order: formattedOrder });
        } catch (error) {
            console.error('[CUSTOMER] Get order failed:', error);
            responseReturn(res, 500, { message: 'Server error' });
        }
    }

    // ==================== PAYMENT METHODS ====================

    async create_payment(req, res) {
        try {
            const { orderId } = req.body;

            if (!process.env.FLUTTERWAVE_SECRET_KEY) {
                throw new Error('Payment gateway not configured');
            }

            const order = await customerOrder.findById(orderId)
                .select('+price +flutterwave_ref')
                .lean();

            if (!order) throw new Error('Order not found');

            const response = await axios.post(
                'https://api.flutterwave.com/v3/payments',
                {
                    tx_ref: order.flutterwave_ref,
                    amount: Math.round(order.price * 100), // Convert to kobo
                    currency: this.currency,
                    redirect_url: `${process.env.CLIENT_URL}/payment/verify`,
                    customer: {
                        email: "customer@ridanexpress.com",
                        name: "Ridan Express Customer",
                    },
                    customizations: {
                        title: 'Ridan Express',
                        description: `Order #${orderId}`,
                        logo: `${process.env.CLIENT_URL}/logo.png`
                    }
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 15000
                }
            );

            responseReturn(res, 200, {
                payment_link: response.data.data.link,
                tx_ref: order.flutterwave_ref
            });

        } catch (error) {
            console.error('[PAYMENT] Create payment failed:', error);
            responseReturn(res, 500, {
                message: error.response?.data?.message || 'Payment initialization failed'
            });
        }
    }

    async order_confirm(req, res) {
        const { orderId } = req.params;
        let { transaction_id } = req.body;
        const session = await mongoose.startSession();

        try {
            await session.withTransaction(async () => {
                // Verify payment with Flutterwave
                const verification = await axios.get(
                    `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
                    {
                        headers: {
                            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        timeout: 20000
                    }
                );

                if (verification.data.status !== 'success') {
                    throw new Error('Payment verification failed');
                }

                const paymentData = verification.data.data;
                const order = await customerOrder.findById(orderId)
                    .session(session)
                    .select('+price +flutterwave_ref +payment_status')
                    .lean();

                // Validation checks
                const errors = [];
                if (!order) errors.push('Order not found');
                if (order.payment_status === 'paid') errors.push('Payment already processed');
                if (paymentData.status !== 'successful') errors.push('Transaction not successful');
                if (paymentData.currency !== this.currency) errors.push('Currency mismatch');
                if (paymentData.tx_ref !== order.flutterwave_ref) errors.push('Reference mismatch');
                if (Math.abs(paymentData.amount - order.price) > 1) errors.push('Amount mismatch');

                if (errors.length > 0) {
                    throw new Error(`Payment validation failed: ${errors.join(', ')}`);
                }

                await this.handlePaymentSuccess(orderId, session);
            });

            responseReturn(res, 200, { message: 'Payment confirmed successfully' });

        } catch (error) {
            console.error('[PAYMENT] Confirm payment failed:', error);
            responseReturn(res, 400, { message: error.message });
        } finally {
            session.endSession();
        }
    }

    // ==================== ADMIN & SELLER METHODS ====================

    async get_admin_orders(req, res) {
        try {
            const orders = await customerOrder.aggregate([
                {
                    $lookup: {
                        from: 'authororders',
                        localField: "_id",
                        foreignField: 'orderId',
                        as: 'suborder'
                    }
                },
                { $sort: { createdAt: -1 } }
            ]);

            responseReturn(res, 200, { orders, totalOrder: orders.length });
        } catch (error) {
            console.error('[ADMIN] Get orders failed:', error);
            responseReturn(res, 500, { message: 'Server error' });
        }
    }

    async get_admin_order(req, res) {
        const { orderId } = req.params;
        try {
            const order = await customerOrder.aggregate([
                { $match: { _id: new ObjectId(orderId) } },
                {
                    $lookup: {
                        from: 'authororders',
                        localField: '_id',
                        foreignField: 'orderId',
                        as: 'suborder'
                    }
                }
            ]);
            responseReturn(res, 200, { order: order[0] });
        } catch (error) {
            console.error('[ADMIN] Get order failed:', error);
            responseReturn(res, 500, { message: 'Server error' });
        }
    }

    async admin_order_status_update(req, res) {
        const session = await mongoose.startSession();
        try {
            const { orderId } = req.params;
            const { status } = req.body;

            await session.withTransaction(async () => {
                await customerOrder.findByIdAndUpdate(
                    orderId,
                    { $set: { delivery_status: status } },
                    { session }
                );
            });

            responseReturn(res, 200, { message: 'Order status updated' });
        } catch (error) {
            console.error('[ADMIN] Status update failed:', error);
            responseReturn(res, 500, { message: 'Failed to update status' });
        } finally {
            session.endSession();
        }
    }

    get_seller_orders = async (req, res) => {
        const { sellerId } = req.params
        let { page, parPage, searchValue } = req.query
        page = parseInt(page)
        parPage = parseInt(parPage)

        const skipPage = parPage * (page - 1)

        try {
            if (searchValue) {
                // Implement search if needed
                const orders = await authOrderModel.find({
                    sellerId,
                    $or: [
                        { 'products.name': { $regex: searchValue, $options: 'i' } },
                        { 'shippingInfo.name': { $regex: searchValue, $options: 'i' } }
                    ]
                }).skip(skipPage).limit(parPage).sort({ createdAt: -1 })

                const totalOrder = await authOrderModel.find({
                    sellerId,
                    $or: [
                        { 'products.name': { $regex: searchValue, $options: 'i' } },
                        { 'shippingInfo.name': { $regex: searchValue, $options: 'i' } }
                    ]
                }).countDocuments()

                responseReturn(res, 200, { orders, totalOrder })
            } else {
                const orders = await authOrderModel.find({
                    sellerId,
                }).skip(skipPage).limit(parPage).sort({ createdAt: -1 })
                const totalOrder = await authOrderModel.find({
                    sellerId,
                }).countDocuments()
                responseReturn(res, 200, { orders, totalOrder })
            }
        } catch (error) {
            console.error('[SELLER] Get orders failed:', error)
            responseReturn(res, 500, { message: 'internal server error' })
        }
    }

    async get_seller_order(req, res) {
        const { orderId } = req.params;
        try {
            const order = await authOrderModel.findById(orderId);
            responseReturn(res, 200, { order });
        } catch (error) {
            console.error('[SELLER] Get order failed:', error);
            responseReturn(res, 500, { message: 'Server error' });
        }
    }

    async seller_order_status_update(req, res) {
        const session = await mongoose.startSession();
        try {
            const { orderId } = req.params;
            const { status } = req.body;

            await session.withTransaction(async () => {
                await authOrderModel.findByIdAndUpdate(
                    orderId,
                    { $set: { delivery_status: status } },
                    { session }
                );
            });

            responseReturn(res, 200, { message: 'Order status updated' });
        } catch (error) {
            console.error('[SELLER] Status update failed:', error);
            responseReturn(res, 500, { message: 'Failed to update status' });
        } finally {
            session.endSession();
        }
    }

    // ==================== WEBHOOK HANDLER ====================

    async handle_flutterwave_webhook(req, res) {
        const signature = req.headers['verif-hash'];
        if (signature !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
            console.warn('[WEBHOOK] Unauthorized webhook attempt');
            return res.status(401).send('Unauthorized');
        }

        // Immediate response to prevent timeout
        res.status(200).end();

        try {
            const { event, data } = req.body;
            if (event !== 'charge.completed') {
                console.log('[WEBHOOK] Ignoring non-payment event:', event);
                return;
            }

            const session = await mongoose.startSession();
            await session.withTransaction(async () => {
                const order = await customerOrder.findOne({ flutterwave_ref: data.tx_ref })
                    .session(session)
                    .select('+payment_status +price')
                    .lean();

                if (!order || order.payment_status === 'paid') {
                    console.log('[WEBHOOK] Order already paid or not found:', data.tx_ref);
                    return;
                }

                // Validate payment details
                const errors = [];
                if (data.currency !== this.currency) errors.push('Currency mismatch');
                if (Math.abs(data.amount - order.price) > 1) errors.push('Amount mismatch');

                if (errors.length > 0) {
                    console.error('[WEBHOOK] Payment validation failed:', errors);
                    return;
                }

                await this.handlePaymentSuccess(order._id, session);
                console.log('[WEBHOOK] Payment processed successfully:', order._id);
            });

        } catch (error) {
            console.error('[WEBHOOK] Processing failed:', error);
        }
    }
}

module.exports = new OrderController();