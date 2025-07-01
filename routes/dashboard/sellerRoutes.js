const router = require('express').Router();
const { authMiddleware, optionalAuthMiddleware } = require('../../middlewares/authMiddleware');
const flutterwaveController = require('../../controllers/dashboard/flutterwaveController');
const sellerController = require('../../controllers/dashboard/sellerController');

router.get('/request-seller-get', authMiddleware, sellerController.get_seller_request);
router.get('/get-sellers', authMiddleware, sellerController.get_active_sellers);
router.get('/get-deactive-sellers', authMiddleware, sellerController.get_deactive_sellers);
router.get('/get-seller/:sellerId', authMiddleware, sellerController.get_seller);
router.post('/seller-status-update', authMiddleware, sellerController.seller_status_update);

// Flutterwave Routes
router.post('/create-flutterwave-subaccount', authMiddleware, flutterwaveController.create_subaccount);
router.post('/fix-recipient/:sellerId', authMiddleware, flutterwaveController.fix_seller_recipient);

// Seller store routes
router.get('/seller-products/:sellerId', optionalAuthMiddleware, sellerController.get_seller_products);
router.get('/seller-details/:sellerId', optionalAuthMiddleware, sellerController.get_seller_details);

// Removed profile_info_add route from here (moved to auth routes)
module.exports = router;