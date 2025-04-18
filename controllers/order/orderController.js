const authOrderModel = require('../../models/authOrder')
const customerOrder = require('../../models/customerOrder')
const cardModel = require('../../models/cardModel')
const myShopWallet = require('../../models/myShopWallet')
const sellerWallet = require('../../models/sellerWallet')
const axios = require('axios')
const { mongo: { ObjectId } } = require('mongoose')
const { responseReturn } = require('../../utiles/response')
const moment = require('moment')

class orderController {
    constructor() {
        this.paymentTimeouts = new Map();
    }
    generateTxRef = () => `ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    // Cancel unpaid orders after timeout
    paymentCheck = async (orderId) => {
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
                console.log(`Order ${orderId} cancelled due to unpaid status`);
            }
        } catch (error) {
            console.error('Payment check error:', error);
        }
    }

    place_order = async (req, res) => {
        const { price, products, shipping_fee, shippingInfo, userId } = req.body;
        const timestamp = moment().format('LLL');

        try {
            // Generate unique transaction reference
            const tx_ref = this.generateTxRef();

            // Create customer order with tx_ref
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

            // Create seller orders
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

            // Clear cart items
            const cartIds = products.flatMap(seller =>
                seller.products.map(item => item._id)
            ).filter(Boolean);
            if (cartIds.length > 0) {
                await cardModel.deleteMany({ _id: { $in: cartIds } });
            }

            // Set payment timeout (default 15 minutes)
            const timeoutMs = parseInt(process.env.PAYMENT_TIMEOUT_MS) || 900000;
            const timer = setTimeout(() =>
                this.paymentCheck(order._id),
                timeoutMs
            );
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


    get_customer_databorad_data = async (req, res) => {
        const {
            userId
        } = req.params

        try {
            const recentOrders = await customerOrder.find({
                customerId: new ObjectId(userId)
            }).limit(5)
            const pendingOrder = await customerOrder.find({
                customerId: new ObjectId(userId),
                delivery_status: 'pending'
            }).countDocuments()
            const totalOrder = await customerOrder.find({
                customerId: new ObjectId(userId)
            }).countDocuments()
            const cancelledOrder = await customerOrder.find({
                customerId: new ObjectId(userId),
                delivery_status: 'cancelled'
            }).countDocuments()
            responseReturn(res, 200, {
                recentOrders,
                pendingOrder,
                cancelledOrder,
                totalOrder
            })
        } catch (error) {
            console.log(error.message)
        }
    }

    get_orders = async (req, res) => {
        const {
            customerId,
            status
        } = req.params

        try {
            let orders = []
            if (status !== 'all') {
                orders = await customerOrder.find({
                    customerId: new ObjectId(customerId),
                    delivery_status: status
                })
            } else {
                orders = await customerOrder.find({
                    customerId: new ObjectId(customerId)
                })
            }
            responseReturn(res, 200, {
                orders
            })
        } catch (error) {
            console.log(error.message)
        }
    }
    get_order = async (req, res) => {
        const {
            orderId
        } = req.params

        try {
            const order = await customerOrder.findById(orderId)
            responseReturn(res, 200, {
                order
            })
        } catch (error) {
            console.log(error.message)
        }
    }

    get_admin_orders = async (req, res) => {
        let { page, parPage, searchValue } = req.query
        page = parseInt(page)
        parPage = parseInt(parPage)

        const skipPage = parPage * (page - 1)

        try {
            if (searchValue) {

            } else {
                const orders = await customerOrder.aggregate([
                    {
                        $lookup: {
                            from: 'authororders',
                            localField: "_id",
                            foreignField: 'orderId',
                            as: 'suborder'
                        }
                    }
                ]).skip(skipPage).limit(parPage).sort({ createdAt: -1 })

                const totalOrder = await customerOrder.aggregate([
                    {
                        $lookup: {
                            from: 'authororders',
                            localField: "_id",
                            foreignField: 'orderId',
                            as: 'suborder'
                        }
                    }
                ])

                responseReturn(res, 200, { orders, totalOrder: totalOrder.length })
            }
        } catch (error) {
            console.log(error.message)
        }
    }

    get_admin_order = async (req, res) => {

        const { orderId } = req.params

        try {
            const order = await customerOrder.aggregate([
                {
                    $match: { _id: new ObjectId(orderId) }
                }, {
                    $lookup: {
                        from: 'authororders',
                        localField: '_id',
                        foreignField: 'orderId',
                        as: 'suborder'
                    }
                }
            ])
            responseReturn(res, 200, { order: order[0] })
        } catch (error) {
            console.log('get admin order ' + error.message)
        }
    }

    admin_order_status_update = async (req, res) => {
        const { orderId } = req.params
        const { status } = req.body

        try {
            await customerOrder.findByIdAndUpdate(orderId, {
                delivery_status: status
            })
            responseReturn(res, 200, { message: 'order status change success' })
        } catch (error) {
            console.log('get admin order status error ' + error.message)
            responseReturn(res, 500, { message: 'internal server error' })
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

    get_seller_order = async (req, res) => {

        const { orderId } = req.params

        try {
            const order = await authOrderModel.findById(orderId)

            responseReturn(res, 200, { order })
        } catch (error) {
            console.log('get admin order ' + error.message)
        }
    }

    seller_order_status_update = async (req, res) => {
        const { orderId } = req.params
        const { status } = req.body

        try {
            await authOrderModel.findByIdAndUpdate(orderId, {
                delivery_status: status
            })
            responseReturn(res, 200, { message: 'order status change success' })
        } catch (error) {
            console.log('get admin order status error ' + error.message)
            responseReturn(res, 500, { message: 'internal server error' })
        }
    }

    create_payment = async (req, res) => {
        const { orderId } = req.body;
    
        try {
            // 1. Add environment variable check
            if (!process.env.FLUTTERWAVE_SECRET_KEY) {
                console.error('FLUTTERWAVE_SECRET_KEY is missing in environment variables');
                return responseReturn(res, 500, { message: 'Payment system error' });
            }
    
            const order = await customerOrder.findById(orderId);
            if (!order) {
                console.error(`Order not found: ${orderId}`);
                return responseReturn(res, 404, { message: 'Order not found' });
            }
    
            // 2. Log the payment initialization details
            console.log('Initializing payment with:', {
                tx_ref: order.flutterwave_ref,
                amount: order.price,
                currency: 'NGN',
                secret_key: process.env.FLUTTERWAVE_SECRET_KEY?.slice(0, 5) + '...' // Partial key for security
            });
    
            // 3. Add full error logging for Flutterwave API call
            const flutterResponse = await axios.post(
                'https://api.flutterwave.com/v3/payments',
                {
                    tx_ref: order.flutterwave_ref,
                    amount: order.price,
                    currency: 'NGN',
                    redirect_url: 'https://ridanexpress-client.vercel.app/payment-callback',
                    customer: {
                        email: 'customer@email.com',
                        name: 'Customer Name'
                    }
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
                        'Content-Type': 'application/json'
                    },
                    timeout: 10000 // 10 seconds timeout
                }
            ).catch(error => {
                // 4. Detailed error logging
                console.error('Flutterwave API Error:', {
                    status: error.response?.status,
                    data: error.response?.data,
                    config: {
                        url: error.config?.url,
                        method: error.config?.method,
                        headers: {
                            authorization: error.config?.headers?.Authorization?.slice(0, 5) + '...'
                        }
                    },
                    message: error.message
                });
                throw error;
            });
    
            // 5. Log successful response
            console.log('Flutterwave Response:', {
                status: flutterResponse.status,
                data: flutterResponse.data
            });
    
            responseReturn(res, 200, { 
                tx_ref: order.flutterwave_ref,
                payment_link: flutterResponse.data.data.link
            });
        } catch (error) {
            // 6. Final error logging
            console.error('Create Payment Endpoint Error:', {
                error: error.stack, // Full error stack trace
                environment: process.env.NODE_ENV,
                orderId,
                secretKeyPresent: !!process.env.FLUTTERWAVE_SECRET_KEY
            });
            
            responseReturn(res, 500, { 
                message: error.response?.data?.message || 'Payment initialization failed' 
            });
        }
    }

    // create_payment = async (req, res) => {
    //     const { price } = req.body

    //     try {
    //         const payment = await stripe.paymentIntents.create({
    //             amount: price * 100,
    //             currency: 'usd',
    //             automatic_payment_methods: {
    //                 enabled: true
    //             }
    //         })
    //         responseReturn(res, 200, { clientSecret: payment.client_secret })
    //     } catch (error) {
    //         console.log(error.message)
    //     }
    // }

    order_confirm = async (req, res) => {
        const { orderId } = req.params;
        const { transaction_id } = req.body;

        try {
            // Validate credentials
            if (!process.env.FLUTTERWAVE_SECRET_KEY) {
                return responseReturn(res, 500, { message: 'Payment system error' });
            }

            // Verify payment
            const verification = await axios.get(
                `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
                { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } }
            );

            const { status, tx_ref, amount } = verification.data.data;
            const order = await customerOrder.findById(orderId);

            // Validate payment
            if (verification.data.status !== 'success') {
                return responseReturn(res, 400, { message: 'Payment verification failed' });
            }
            if (!order) return responseReturn(res, 404, { message: 'Order not found' });
            if (status !== 'successful') return responseReturn(res, 400, { message: 'Payment failed' });
            if (tx_ref !== order.flutterwave_ref) return responseReturn(res, 400, { message: 'Transaction mismatch' });

            // Critical Fix: Convert order.price to kobo
            if (Math.round(amount) !== Math.round(order.price * 100)) {
                return responseReturn(res, 400, { message: 'Amount mismatch' });
            }

            // Clear timeout using MongoDB _id
            const timeoutId = this.paymentTimeouts.get(order._id.toString());
            if (timeoutId) {
                clearTimeout(timeoutId);
                this.paymentTimeouts.delete(order._id.toString());
            }

            // Update orders
            await customerOrder.findByIdAndUpdate(orderId, {
                payment_status: 'paid',
                delivery_status: 'processing'
            });

            await authOrderModel.updateMany(
                { orderId: order._id },
                { payment_status: 'paid', delivery_status: 'processing' }
            );

            // Update wallets
            const now = moment();
            const month = now.month() + 1;
            const year = now.year();

            await myShopWallet.create({ amount: order.price, month, year });

            const sellerOrders = await authOrderModel.find({ orderId: order._id });
            await Promise.all(sellerOrders.map(async (sellerOrder) => {
                await sellerWallet.create({
                    sellerId: sellerOrder.sellerId,
                    amount: sellerOrder.price,
                    month,
                    year
                });
            }));

            responseReturn(res, 200, { message: 'Payment confirmed' });
        } catch (error) {
            console.error('Confirmation error:', error);
            responseReturn(res, 500, { message: 'Payment processing failed' });
        }
    }

    // Webhook to handle asynchronous Flutterwave events
     handle_flutterwave_webhook = async (req, res) => {
        const signature = req.headers['verif-hash'] || req.headers['Verif-Hash'];
        
        // 1. Validate webhook signature
        if (!signature || signature !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
            console.warn('Invalid webhook signature');
            return res.status(401).json({ 
                status: 'error', 
                message: 'Unauthorized' 
            });
        }

        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
            const event = req.body;
            
            // 2. Process only successful charges
            if (event.event === 'charge.completed') {
                const transaction = event.data;
                const txRef = transaction.tx_ref;
                
                // 3. Validate transaction
                if (transaction.status !== 'successful') {
                    console.log(`Transaction ${txRef} not successful: ${transaction.status}`);
                    return res.status(200).end();
                }

                // 4. Find and validate order
                const order = await customerOrder.findOne({ 
                    flutterwave_ref: txRef 
                }).session(session);

                if (!order) {
                    console.error(`Order not found for tx_ref: ${txRef}`);
                    return res.status(404).end();
                }

                // 5. Check if already processed
                if (order.payment_status === 'paid') {
                    console.log(`Order ${order._id} already marked as paid`);
                    return res.status(200).end();
                }

                // 6. Validate amount (convert to kobo/pesewas)
                const paidAmount = parseFloat(transaction.amount);
                const orderAmount = parseFloat(order.price);
                
                if (Math.abs(paidAmount - orderAmount) > 0.01) {
                    console.error(`Amount mismatch for order ${order._id}: 
                        Paid ${paidAmount} vs Order ${orderAmount}`);
                    throw new Error('Amount mismatch');
                }

                // 7. Update order statuses
                await customerOrder.findByIdAndUpdate(
                    order._id,
                    {
                        payment_status: 'paid',
                        delivery_status: 'processing',
                        payment_date: new Date()
                    },
                    { session }
                );

                await authOrderModel.updateMany(
                    { orderId: order._id },
                    {
                        payment_status: 'paid',
                        delivery_status: 'processing'
                    },
                    { session }
                );

                // 8. Clear payment timeout
                const timeoutId = this.paymentTimeouts.get(order._id.toString());
                if (timeoutId) {
                    clearTimeout(timeoutId);
                    this.paymentTimeouts.delete(order._id.toString());
                    console.log(`Cleared timeout for order ${order._id}`);
                }

                // 9. Credit wallets
                const now = moment();
                const month = now.month() + 1;
                const year = now.year();

                // Credit main shop wallet
                await myShopWallet.create([{
                    amount: order.price,
                    month,
                    year,
                    orderId: order._id,
                    transactionId: transaction.id
                }], { session });

                // Credit individual seller wallets
                const sellerOrders = await authOrderModel.find(
                    { orderId: order._id }
                ).session(session);

                await Promise.all(sellerOrders.map(async (sellerOrder) => {
                    await sellerWallet.create([{
                        sellerId: sellerOrder.sellerId,
                        amount: sellerOrder.price,
                        month,
                        year,
                        orderId: order._id,
                        transactionId: transaction.id
                    }], { session });
                }));

                // 10. Commit transaction
                await session.commitTransaction();
                console.log(`Successfully processed payment for order ${order._id}`);

                return res.status(200).end();
            } else {
                console.log(`Ignoring non-payment event: ${event.event}`);
                return res.status(200).end();
            }
        } catch (error) {
            // 11. Abort transaction on error
            await session.abortTransaction();
            console.error('Webhook processing error:', {
                error: error.message,
                stack: error.stack,
                event: req.body
            });
            return res.status(500).json({
                status: 'error',
                message: 'Internal server error'
            });
        } finally {
            session.endSession();
        }
    }


    // order_confirm = async (req, res) => {
    //     const { orderId } = req.params
    //     try {
    //         await customerOrder.findByIdAndUpdate(orderId, { payment_status: 'paid', delivery_status: 'pending' })
    //         await authOrderModel.updateMany({ orderId: new ObjectId(orderId) }, {
    //             payment_status: 'paid', delivery_status: 'pending'
    //         })
    //         const cuOrder = await customerOrder.findById(orderId)

    //         const auOrder = await authOrderModel.find({
    //             orderId: new ObjectId(orderId)
    //         })

    //         const time = moment(Date.now()).format('l')

    //         const splitTime = time.split('/')

    //         await myShopWallet.create({
    //             amount: cuOrder.price,
    //             manth: splitTime[0],
    //             year: splitTime[2],
    //         })

    //         for (let i = 0; i < auOrder.length; i++) {
    //             await sellerWallet.create({
    //                 sellerId: auOrder[i].sellerId.toString(),
    //                 amount: auOrder[i].price,
    //                 manth: splitTime[0],
    //                 year: splitTime[2],
    //             })
    //         }

    //         responseReturn(res, 200, { message: 'success' })

    //     } catch (error) {
    //         console.log(error.message)
    //     }
    // }
}

module.exports = new orderController()