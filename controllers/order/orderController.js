const authOrderModel = require('../../models/authOrder')
const customerOrder = require('../../models/customerOrder')
const cardModel = require('../../models/cardModel')
const myShopWallet = require('../../models/myShopWallet')
const sellerWallet = require('../../models/sellerWallet')
const axios = require('axios')

const { mongo: { ObjectId } } = require('mongoose')
const { responseReturn } = require('../../utiles/response')

const moment = require('moment')
// const stripe = require('stripe')(process.env.stripe_key)

class orderController {

    constructor() {
        this.paymentTimeouts = new Map(); // Initialize here
        this.paymentCheck = this.paymentCheck.bind(this); // Bind context
    }

    // Cancel unpaid orders after timeout
    paymentCheck = async (orderId) => {
        try {
            const order = await customerOrder.findById(orderId);
            if (order && order.payment_status === 'unpaid') {
                await customerOrder.findByIdAndUpdate(orderId, { delivery_status: 'cancelled' });
                await authOrderModel.updateMany({ orderId }, { delivery_status: 'cancelled' });
                console.warn(`Order ${orderId} auto-cancelled due to unpaid status.`);
            }
        } catch (err) {
            console.error('Payment check error:', err);
        }
    }

    place_order = async (req, res) => {
        const { price, products, shipping_fee, shippingInfo, userId } = req.body;
        const timestamp = moment().format('LLL');

        try {
            // Create customer order
            const order = await customerOrder.create({
                customerId: userId,
                shippingInfo,
                products: products.flatMap(seller =>
                    seller.products.map(item => ({ ...item.productInfo, quantity: item.quantity }))
                ),
                price: price + shipping_fee,
                delivery_status: 'pending',
                payment_status: 'unpaid',
                date: timestamp
            });

            // Create author (seller) orders
            const authorOrders = products.map(seller => ({
                orderId: order.id,
                sellerId: seller.sellerId,
                products: seller.products.map(item => ({ ...item.productInfo, quantity: item.quantity })),
                price: seller.price,
                payment_status: 'unpaid',
                shippingInfo: 'Dhaka myshop Warehouse',
                delivery_status: 'pending',
                date: timestamp
            }));
            await authOrderModel.insertMany(authorOrders);

            // Remove from cart
            const cartIds = products.flatMap(seller => seller.products.map(item => item._id)).filter(Boolean);
            if (cartIds.length) await cardModel.deleteMany({ _id: { $in: cartIds } });

            // Start cancellation timer (default 2 minutes)
            const timeoutMs = parseInt(process.env.PAYMENT_TIMEOUT_MS) || 120000;
            const timer = setTimeout(() => {
                this.paymentCheck(order.id);
                this.paymentTimeouts.delete(order.id);
            }, timeoutMs);
            this.paymentTimeouts.set(order.id, timer);

            responseReturn(res, 201, { message: 'Order placed successfully', orderId: order.id });
        } catch (err) {
            console.error('Place order error:', err.message);
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
        // Generate Flutterwave transaction reference
        const tx_ref = `ORDER-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        res.status(200).json({ tx_ref });
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
            // Verify with Flutterwave
            const verification = await axios.get(
                `https://api.flutterwave.com/v3/transactions/${transaction_id}/verify`,
                { headers: { Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}` } }
            );
            const data = verification.data.data;
            if (data.status !== 'successful') return responseReturn(res, 400, { message: 'Payment not successful' });

            // Validate order and amount
            const order = await customerOrder.findById(orderId);
            if (!order) return responseReturn(res, 404, { message: 'Order not found' });

            const paidAmt = Math.round(data.amount * 100);
            const orderAmt = Math.round(order.price * 100);
            if (paidAmt !== orderAmt) {
                return responseReturn(res, 400, { message: `Amount mismatch: paid=${paidAmt / 100}, expected=${orderAmt / 100}` });
            }

            // Clear cancellation timer
            if (this.paymentTimeouts.has(orderId)) {
                clearTimeout(this.paymentTimeouts.get(orderId));
                this.paymentTimeouts.delete(orderId);
            }

            // Update statuses
            await customerOrder.findByIdAndUpdate(orderId, {
                payment_status: 'paid',
                delivery_status: 'pending',
                flutterwave_ref: data.tx_ref
            });
            await authOrderModel.updateMany({ orderId: new ObjectId(orderId) }, {
                payment_status: 'paid',
                delivery_status: 'pending'
            });

            // Credit wallets
            const now = moment();
            const month = now.month() + 1, year = now.year();
            await myShopWallet.create({ amount: order.price, month, year });
            const authOrders = await authOrderModel.find({ orderId: new ObjectId(orderId) });
            await Promise.all(authOrders.map(aO =>
                sellerWallet.create({ sellerId: aO.sellerId, amount: aO.price, month, year })
            ));

            responseReturn(res, 200, { message: 'Payment confirmed successfully' });
        } catch (err) {
            console.error('Order confirmation error:', err.response?.data || err.message);
            responseReturn(res, 500, { message: 'Payment processing failed' });
        }
    }

    // Webhook to handle asynchronous Flutterwave events
    handle_flutterwave_webhook = async (req, res) => {
        const signature = req.headers['verif-hash'];
        if (signature !== process.env.FLUTTERWAVE_WEBHOOK_HASH) {
            console.warn('Invalid webhook signature:', signature);
            return res.status(401).send('Unauthorized');
        }

        try {
            const event = req.body;
            if (event.event === 'charge.completed') {
                const txRef = event.data.tx_ref;
                const order = await customerOrder.findOneAndUpdate(
                    { flutterwave_ref: txRef },
                    { payment_status: 'paid', delivery_status: 'pending' },
                    { new: true }
                );
                if (order) {
                    // Update seller suborders
                    await authOrderModel.updateMany(
                        { orderId: new ObjectId(order._id) },
                        { payment_status: 'paid', delivery_status: 'pending' }
                    );

                    // Clear timeout
                    const key = order._id.toString();
                    if (this.paymentTimeouts.has(key)) {
                        clearTimeout(this.paymentTimeouts.get(key));
                        this.paymentTimeouts.delete(key);
                    }

                    // Credit wallets
                    const now = moment();
                    const month = now.month() + 1, year = now.year();
                    await myShopWallet.create({ amount: order.price, month, year });
                    const authOrders = await authOrderModel.find({ orderId: order._id });
                    await Promise.all(authOrders.map(aO =>
                        sellerWallet.create({ sellerId: aO.sellerId, amount: aO.price, month, year })
                    ));
                }
            }
            res.status(200).end();
        } catch (err) {
            console.error('Webhook processing error:', err);
            res.status(500).end();
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