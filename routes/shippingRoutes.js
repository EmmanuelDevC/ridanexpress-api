const router = require('express').Router();
const shippingController = require('../controllers/shippingController');
// const { sellerAuth } = require('../middlewares/authMiddleware');

// ===== SHIPPING CALCULATION & OPTIONS ROUTES =====
router.get('/shipping/vehicles', shippingController.get_vehicle_options);
router.get('/shipping/loaders', shippingController.get_loader_options);
router.post('/shipping/calculate', shippingController.calculate_shipping);
router.post('/shipping/calculate-single', shippingController.calculate_single_shipping);
router.post('/shipping/validate-address', shippingController.validate_address);
router.get('/shipping/availability', shippingController.get_service_availability);
router.post('/shipping/rates', shippingController.get_shipping_rates);

module.exports = router;