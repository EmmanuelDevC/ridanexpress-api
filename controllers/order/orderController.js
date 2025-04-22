const mongoose = require('mongoose');
const { Types: { ObjectId } } = mongoose;
const authOrderModel = require('../../models/authOrder');
const customerOrder = require('../../models/customerOrder');
const cardModel = require('../../models/cardModel');
const myShopWallet = require('../../models/myShopWallet');
const sellerWallet = require('../../models/sellerWallet');
const axios = require('axios');
const { responseReturn } = require('../../utiles/response');
const moment = require('moment');

class orderController {

    constructor() {
        this.paymentTimeouts = new Map();
        this.paymentTimeout = parseInt(process.env.PAYMENT_TIMEOUT_MS) || 900000;
        this.currency = 'NGN';

        // Bind all controller methods to 'this'
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
        this.seller_order_status_update = this.seller_order_status_update.bind(this);
        this.handle_flutterwave_webhook = this.handle_flutterwave_webhook.bind(this);
    }

    // ==================== CORE METHODS ====================
    generateTxRef() {
        return `FLW-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    }
    async handlePaymentSuccess(orderId, session) {
        const now = moment();
        try {
            const order = await customerOrder.findById(orderId)
                .session(session)
                .select('+price +payment_status')
                .lean();

            if (!order || order.payment_status === 'paid') return;

            // Update order status to match Stripe flow
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

            // Create shop wallet entry (match Stripe's date format)
            const dateString = now.format('L').split('/');
            await myShopWallet.create([{
                amount: order.price,
                manth: dateString[0], // Month from formatted date
                year: dateString[2],  // Year from formatted date
                orderId,
                createdAt: now.toDate()
            }], { session });

            // Create seller wallet entries
            const sellerOrders = await authOrderModel.find({ orderId }).session(session);
            await Promise.all(
                sellerOrders.map(order =>
                    sellerWallet.create([{
                        sellerId: order.sellerId,
                        amount: order.price,
                        manth: dateString[0],
                        year: dateString[2],
                        orderId,
                        createdAt: now.toDate()
                    }], { session })
                )
            );

            this.clearPaymentTimeout(orderId);
        } catch (error) {
            console.error('Payment success handling failed:', error);
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

    // ==================== CUSTOMER ROUTES ====================
    async place_order(req, res) {
        const session = await mongoose.startSession();
        let order; // Declare order here
        try {
            // Destructure with proper validation
            const {
                price,
                products,
                shipping_fee,
                shippingInfo,
                userId
            } = req.body;

            if (!products || !Array.isArray(products)) {
                throw new Error('Invalid products data');
            }

            // Debugging log (properly scoped)
            console.log('Processing products:', JSON.stringify(products, null, 2));

            const tx_ref = this.generateTxRef();
            if (!tx_ref) throw new Error('Failed to generate payment reference');

            await session.withTransaction(async () => {
                // Create main order
                const createdOrder = await customerOrder.create([{
                    customerId: userId,
                    shippingInfo,
                    products: products.flatMap(seller =>
                        seller.products.map(item => ({
                            productId: item.productInfo._id, // Match your data structure
                            price: item.productInfo.price,
                            quantity: item.quantity
                        }))
                    ),
                    price: parseFloat(price + shipping_fee).toFixed(2),
                    currency: this.currency,
                    delivery_status: 'pending',
                    payment_status: 'unpaid',
                    flutterwave_ref: tx_ref,
                    createdAt: new Date()
                }], { session });

                order = createdOrder[0]; // Assign the created order to the variable

                // Create seller orders (corrected mapping)
                const authOrders = products.map(seller => {
                    // Validate seller data
                    if (!seller?.sellerId || !seller?.price) {
                        console.error('Invalid seller:', seller);
                        throw new Error('Invalid seller data');
                    }

                    return {
                        orderId: order._id,
                        sellerId: seller.sellerId,
                        products: seller.products.map(item => ({
                            productId: item.productInfo._id,
                            price: item.productInfo.price,
                            quantity: item.quantity
                        })),
                        price: seller.price, // Changed to match your data
                        payment_status: 'unpaid',
                        delivery_status: 'pending',
                        createdAt: new Date()
                    };
                });

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
                        const session = await mongoose.startSession();
                        try {
                            await session.withTransaction(async () => {
                                await customerOrder.findByIdAndUpdate(
                                    order._id,
                                    { $set: { payment_status: 'failed', delivery_status: 'cancelled' } },
                                    { session }
                                );
                                await authOrderModel.updateMany(
                                    { orderId: order._id },
                                    { $set: { delivery_status: 'cancelled' } },
                                    { session }
                                );
                            });
                        } finally {
                            session.endSession();
                        }
                    }, this.paymentTimeout)
                );
            });

            responseReturn(res, 201, {
                message: 'Order placed successfully',
                orderId: order._id,
                tx_ref
            });

        } catch (error) {
            console.error('Order error:', error.message);
            responseReturn(res, 500, { message: error.message });
        } finally {
            session.endSession();
        }
    }


    // // Clear cart items
    // const cartIds = products.flatMap(seller =>
    //     seller.products.map(item => item._id).filter(Boolean)
    // );
    // if (cartIds.length > 0) {
    //     await cardModel.deleteMany({ _id: { $in: cartIds } }).session(session);
    // }

    // // Set payment timeout
    // this.paymentTimeouts.set(
    //     order._id.toString(),
    //     setTimeout(async () => {
    //         const session = await mongoose.startSession();
    //         try {
    //             await session.withTransaction(async () => {
    //                 await customerOrder.findByIdAndUpdate(
    //                     order._id,
    //                     { $set: { payment_status: 'failed', delivery_status: 'cancelled' } },
    //                     { session }
    //                 );
    //                 await authOrderModel.updateMany(
    //                     { orderId: order._id },
    //                     { $set: { delivery_status: 'cancelled' } },
    //                     { session }
    //                 );
    //             });
    //         } finally {
    //             session.endSession();
    //         }
    //     }, this.paymentTimeout)
    // );

    async get_customer_databorad_data(req, res) {
        const { userId } = req.params;
        try {
            const recentOrders = await customerOrder.find({ customerId: new ObjectId(userId) }).limit(5);
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
            console.log(error.message);
            responseReturn(res, 500, { message: 'Server error' });
        }
    }

    async get_orders(req, res) {
        const { customerId, status } = req.params;
        try {
            const query = { customerId: new ObjectId(customerId) };
            if (status !== 'all') query.delivery_status = status;

            const orders = await customerOrder.find(query);
            responseReturn(res, 200, { orders });
        } catch (error) {
            console.log(error.message);
            responseReturn(res, 500, { message: 'Server error' });
        }
    }

    async get_order(req, res) {
        const { orderId } = req.params;
        try {
            const order = await customerOrder.findById(orderId);
            responseReturn(res, 200, { order });
        } catch (error) {
            console.log(error.message);
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
                    amount: order.price,
                    currency: this.currency,
                    redirect_url: "https://ridanexpress-client.vercel.app/payment/verify",
                    customer: {
                        email: "email@gmail.com",
                        name: "Test User",
                    },
                    customizations: {
                        title: 'Ridan express'
                        // logo: process.env.LOGO_URL
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
            console.error('Payment initiation error:', error);
            responseReturn(res, 500, {
                message: error.response?.data?.message || 'Payment initialization failed'
            });
        }
    }



    async order_confirm(req, res) {
        const { orderId } = req.params;
        const { transaction_id } = req.body;
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
            console.error('Payment confirmation error:', error);
            responseReturn(res, 400, { message: error.message });
        } finally {
            session.endSession();
        }
    }

    // ==================== ADMIN ROUTES ====================
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
            console.log(error.message);
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
            console.log(error.message);
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
            console.error('Status update error:', error);
            responseReturn(res, 500, { message: 'Failed to update status' });
        } finally {
            session.endSession();
        }
    }

    // ==================== SELLER ROUTES ====================
    get_seller_orders = async (req, res) => {

        const { sellerId } = req.params
        let { page, parPage, searchValue } = req.query
        page = parseInt(page)
        parPage = parseInt(parPage)

        const skipPage = parPage * (page - 1)


        try {
            if (searchValue) {

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
            console.log('get seller order error ' + error.message)
            responseReturn(res, 500, { message: 'internal server error' })
        }
    }

    async get_seller_order(req, res) {
        const { orderId } = req.params;
        try {
            const order = await authOrderModel.findById(orderId);
            responseReturn(res, 200, { order });
        } catch (error) {
            console.log(error.message);
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
            console.error('Seller status update error:', error);
            responseReturn(res, 500, { message: 'Failed to update status' });
        } finally {
            session.endSession();
        }
    }

    // ==================== WEBHOOK HANDLER ====================
    async handle_flutterwave_webhook(req, res) {
        const signature = req.headers['verif-hash'];
        if (signature !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
            return res.status(401).send('Unauthorized');
        }

        // Immediate response to prevent timeout
        res.status(200).end();

        try {
            const { event, data } = req.body;
            if (event !== 'charge.completed') return;

            const session = await mongoose.startSession();
            await session.withTransaction(async () => {
                const order = await customerOrder.findOne({ flutterwave_ref: data.tx_ref })
                    .session(session)
                    .select('+payment_status +price')
                    .lean();

                if (!order || order.payment_status === 'paid') return;

                // Validate payment details
                const errors = [];
                if (data.currency !== this.currency) errors.push('Currency mismatch');
                if (Math.abs(data.amount - order.price) > 1) errors.push('Amount mismatch');

                if (errors.length > 0) {
                    console.error('Webhook validation failed:', errors);
                    return;
                }

                await this.handlePaymentSuccess(order._id, session);
            });

        } catch (error) {
            console.error('Webhook processing error:', error);
        }
    }
}

module.exports = new orderController();