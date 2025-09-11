const express = require('express');
const router = express.Router();
const { authMiddleware } = require('.././middlewares/authMiddleware');
const productController = require('.././controllers/dashboard/productController');

// Apply admin authentication middleware to all routes
router.use(authMiddleware);

// Pending products for approval
router.get('/pending-products', productController.get_pending_products);

// Approve a product
router.put('/approve-product/:productId', productController.approve_product);

// Reject a product
router.put('/reject-product/:productId', productController.reject_product);

module.exports = router;