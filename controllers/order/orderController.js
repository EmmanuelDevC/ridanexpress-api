const authOrderModel = require('../../models/authOrder');
const customerOrder = require('../../models/customerOrder');
const cardModel = require('../../models/cardModel');
const myShopWallet = require('../../models/myShopWallet');
const sellerWallet = require('../../models/sellerWallet');
const axios = require('axios');
const { mongo: { ObjectId, startSession } } = require('mongoose');
const { responseReturn } = require('../../utiles/response');
const moment = require('moment');

class orderController {
    constructor() {
        this.paymentTimeouts = new Map();
        this.generateTxRef = this.generateTxRef.bind(this);
        this.place_order = this.place_order.bind(this);
    }

    clearPaymentTimeout(orderId) {
        const timeoutId = this.paymentTimeouts.get(orderId.toString());
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.paymentTimeouts.delete(orderId.toString());
        }
    }

    // ==================== CORE METHODS ====================
    generateTxRef = () => `ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    async paymentCheck(orderId) {
        try {
            const order = await customerOrder.findById(orderId);
            if (order && order.payment_status === 'unpaid') {
                await customerOrder.findByIdAndUpdate(orderId, {
                    delivery_status: 'cancelled',
                    payment_status: 'cancelled'
                });
                await authOrderModel.updateMany(
                    { orderId },
                    { delivery_status: 'cancelled' }
                );
            }
        } catch (error) {
            console.error('Payment check error:', error);
        }
    }

    // ==================== CUSTOMER ROUTES ====================
    async place_order(req, res) {
        const { price, products, shipping_fee, shippingInfo, userId } = req.body;
        const timestamp = moment().format('LLL');

        try {
            const tx_ref = this.generateTxRef();
            const order = await customerOrder.create({
                customerId: userId,
                shippingInfo,
                products: products.flatMap(seller =>
                    seller.products.map(item => ({
                        ...item.productInfo,
                        quantity: item.quantity
                    }))
                ),
                price: price + shipping_fee,
                delivery_status: 'pending',
                payment_status: 'unpaid',
                flutterwave_ref: tx_ref,
                date: timestamp
            });

            const authOrders = products.map(seller => ({
                orderId: order._id,
                sellerId: seller.sellerId,
                products: seller.products.map(item => ({
                    ...item.productInfo,
                    quantity: item.quantity
                })),
                price: seller.price,
                payment_status: 'unpaid',
                shippingInfo: 'Dhaka myshop Warehouse',
                delivery_status: 'pending',
                date: timestamp
            }));

            await authOrderModel.insertMany(authOrders);

            const cartIds = products.flatMap(seller =>
                seller.products.map(item => item._id)
                    .filter(Boolean));

            if (cartIds.length > 0) {
                await cardModel.deleteMany({ _id: { $in: cartIds } });
            }

            const timeoutMs = parseInt(process.env.PAYMENT_TIMEOUT_MS) || 900000;
            const timer = setTimeout(() => this.paymentCheck(order._id), timeoutMs);
            this.paymentTimeouts.set(order._id.toString(), timer);

            responseReturn(res, 201, {
                message: 'Order placed successfully',
                orderId: order._id,
                tx_ref
            });

        } catch (error) {
            console.error('Place order error:', error);
            responseReturn(res, 500, { message: 'Internal server error' });
        }
    }

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
        const { orderId } = req.body;
        try {
            if (!process.env.FLUTTERWAVE_SECRET_KEY) {
                return responseReturn(res, 500, { message: 'Payment system error' });
            }

            const order = await customerOrder.findById(orderId);
            const response = await axios.post(
                'https://api.flutterwave.com/v3/payments',
                {
                    tx_ref: order.flutterwave_ref,
                    amount: order.price,
                    currency: 'NGN',
                    redirect_url: 'https://ridanexpress.vercel.app/payment-callback',
                    customer: { email: 'customer@email.com', name: 'Customer Name' }
                },
                {
                    headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` },
                    timeout: 10000
                }
            );

            responseReturn(res, 200, {
                tx_ref: order.flutterwave_ref,
                payment_link: response.data.data.link
            });

        } catch (error) {
            console.error('Payment error:', error);
            responseReturn(res, 500, { message: 'Payment initialization failed' });
        }
    }

    // Add this in the CORE METHODS section
    async handlePaymentSuccess(orderId, session) {
        const now = moment();
        const month = now.month() + 1;
        const year = now.year();

        // Update order status
        await customerOrder.findByIdAndUpdate(
            orderId,
            {
                payment_status: 'paid',
                delivery_status: 'processing'
            },
            { session }
        );

        // Update auth orders
        await authOrderModel.updateMany(
            { orderId },
            {
                payment_status: 'paid',
                delivery_status: 'processing'
            },
            { session }
        );

        // Update wallets
        const order = await customerOrder.findById(orderId).session(session);

        // MyShop Wallet
        await myShopWallet.create([{
            amount: order.price,
            month,
            year,
            orderId: order._id
        }], { session });

        // Seller Wallets
        const sellerOrders = await authOrderModel.find({ orderId }).session(session);
        const walletUpdates = sellerOrders.map(({ sellerId, price }) => ({
            sellerId,
            amount: price,
            month,
            year,
            orderId: order._id
        }));

        if (walletUpdates.length > 0) {
            await sellerWallet.insertMany(walletUpdates, { session });
        }

        // Clear payment timeout
        this.clearPaymentTimeout(orderId);
    }

    async order_confirm(req, res) {
        const { orderId } = req.params;
        const { transaction_id } = req.body;
        const session = await startSession();

        try {
            // Validate inputs
            if (!transaction_id || transaction_id.length < 10) {
                throw new Error('Invalid transaction ID');
            }

            if (!process.env.FLUTTERWAVE_SECRET_KEY) {
                throw new Error('Payment system configuration error');
            }

            session.startTransaction();

            // 1. Verify payment with Flutterwave
            const verification = await axios.get(
                `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                    },
                    timeout: 20000
                }
            );

            // 2. Validate verification response
            if (verification.data.status !== 'success') {
                console.error('Flutterwave verification failed:', verification.data);
                throw new Error('Payment verification failed');
            }

            const paymentData = verification.data.data;

            // 3. Get and validate order
            const order = await customerOrder.findById(orderId)
                .session(session)
                .select('+payment_status')
                .lockForUpdate();
            if (!order) throw new Error('Order not found');
            if (order.payment_status === 'paid') {
                throw new Error('Payment already processed');
            }

            // 4. Validate transaction details
            const validationChecks = [
                paymentData.status === 'successful',
                paymentData.currency === 'NGN',
                paymentData.tx_ref === order.flutterwave_ref,
                Math.abs(paymentData.amount - order.price) < 1 // Allow 1 Naira difference
            ];

            if (!validationChecks.every(check => check)) {
                console.error('Validation failed:', {
                    status: paymentData.status,
                    currency: paymentData.currency,
                    tx_ref: paymentData.tx_ref,
                    amount: paymentData.amount,
                    orderPrice: order.price
                });
                throw new Error('Transaction validation failed');
            }

            // 5. Process payment
            await this.handlePaymentSuccess(orderId, session);
            await session.commitTransaction();

            responseReturn(res, 200, { message: 'Payment confirmed successfully' });

        } catch (error) {
            await session.abortTransaction();
            console.error('Payment confirmation error:', {
                orderId,
                error: error.message,
                stack: error.stack
            });
            responseReturn(res, 500, { message: error.message });
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
        const { orderId } = req.params;
        const { status } = req.body;
        try {
            await customerOrder.findByIdAndUpdate(orderId, { delivery_status: status });
            responseReturn(res, 200, { message: 'Status updated' });
        } catch (error) {
            console.log(error.message);
            responseReturn(res, 500, { message: 'Update failed' });
        }
    }

    // ==================== SELLER ROUTES ====================
    async get_seller_orders(req, res) {
        const { sellerId } = req.params;
        try {
            const orders = await authOrderModel.find({ sellerId }).sort('-createdAt');
            responseReturn(res, 200, { orders, totalOrder: orders.length });
        } catch (error) {
            console.log(error.message);
            responseReturn(res, 500, { message: 'Server error' });
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
        const { orderId } = req.params;
        const { status } = req.body;
        try {
            await authOrderModel.findByIdAndUpdate(orderId, { delivery_status: status });
            responseReturn(res, 200, { message: 'Status updated' });
        } catch (error) {
            console.log(error.message);
            responseReturn(res, 500, { message: 'Update failed' });
        }
    }

    // ==================== WEBHOOK HANDLER ====================
    async handle_flutterwave_webhook(req, res) {
        const signature = req.headers['verif-hash'];
        if (signature !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
            return res.status(401).send('Unauthorized');
        }

        // Immediately respond to Flutterwave
        res.status(200).end();

        try {
            const event = req.body;
            if (event.event !== 'charge.completed') return;

            const session = await startSession();
            await session.withTransaction(async () => {
                const txRef = event.data.tx_ref;
                const order = await customerOrder.findOne({ flutterwave_ref: txRef })
                    .session(session)
                    .select('+payment_status');

                if (!order || order.payment_status === 'paid') return;

                await this.handlePaymentSuccess(order._id, session);
            });
        } catch (error) {
            console.error('Webhook processing error:', error);
        }
    }
}

module.exports = new orderController();