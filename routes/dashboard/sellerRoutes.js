const router = require('express').Router()
const { authMiddleware, optionalAuthMiddleware  } = require('../../middlewares/authMiddleware')
const sellerController = require('../../controllers/dashboard/sellerController')

router.get('/request-seller-get',authMiddleware,sellerController.get_seller_request)

router.get('/get-sellers',authMiddleware,sellerController.get_active_sellers)
router.get('/get-deactive-sellers',authMiddleware,sellerController.get_deactive_sellers)

router.get('/get-seller/:sellerId',authMiddleware,sellerController.get_seller)
router.post('/seller-status-update',authMiddleware,sellerController.seller_status_update)

// Add these new routes for seller store functionality
router.get( '/seller-products/:sellerId',  optionalAuthMiddleware, sellerController.get_seller_products)
router.get('/seller-details/:sellerId',  optionalAuthMiddleware, sellerController.get_seller_details)

module.exports = router