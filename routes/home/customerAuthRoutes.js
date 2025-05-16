const router = require('express').Router();
const customerAuthController = require('../../controllers/home/customerAuthController');
const { authMiddleware } = require('../../middlewares/authMiddleware');

// Authentication Routes
router.post('/customer-register', customerAuthController.customer_register);
router.post('/customer-login', customerAuthController.customer_login);
router.get('/customer-logout', authMiddleware, customerAuthController.customer_logout);

// Verification Routes
router.get('/verify-email', customerAuthController.verify_email);
router.post('/resend-verification', customerAuthController.resend_verification);

// Protected Profile Routes
router.patch('/customer/update/:id', authMiddleware, customerAuthController.customer_update)
module.exports = router;

//Password Reset Routes
router.post('/reset-password', customerAuthController.reset_password);