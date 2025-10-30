const router = require('express').Router()
const orderController = require('../../controllers/order/orderController')
// const { sellerAuth } = require('../../middlewares/authMiddleware')

// ---- CUSTOMER ROUTES

router.post('/home/order/place-order', orderController.place_order)
router.post('/home/order/seller-addresses', orderController.get_seller_addresses)
router.post('/home/order/seller-phones', orderController.get_seller_phones);
router.get('/home/customer/get-dashboard-data/:userId', orderController.get_customer_databorad_data)
router.get('/home/customer/get-orders/:customerId/:status', orderController.get_orders)
router.get('/home/customer/get-order/:orderId', orderController.get_order)
router.post('/order/create-payment', orderController.create_payment)
router.post('/order/confirm/:orderId', orderController.order_confirm)
router.post('/flutterwave-webhook', orderController.handle_flutterwave_webhook)

// --- ADMIN ROUTES

router.get('/admin/orders', orderController.get_admin_orders)
router.get('/admin/order/:orderId', orderController.get_admin_order)
router.put('/admin/order-status/update/:orderId', orderController.admin_order_status_update)

// --- SELLER ROUTES

router.get('/seller/orders/:sellerId', orderController.get_seller_orders)
router.get('/seller/order/:orderId', orderController.get_seller_order)
router.put('/seller/order-status/update/:orderId', orderController.seller_order_status_update)

// ===== KWIK DELIVERY ROUTES (Order-specific) =====
router.put('/seller/accept-with-kwik/:orderId', orderController.accept_order_with_kwik)
router.get('/seller/track-delivery/:orderId', orderController.track_delivery)
router.delete('/orders/:orderId/kwik', orderController.cancel_kwik_delivery)
router.post('/kwik/webhook', orderController.kwik_webhook)
router.get('/test-kwik', orderController.test_kwik_integration)

module.exports = router