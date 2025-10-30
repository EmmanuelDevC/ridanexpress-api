const router = require('express').Router();
const orderController = require('../controllers/order/orderController');

router.post('/kwik', orderController.kwik_webhook);

module.exports = router;