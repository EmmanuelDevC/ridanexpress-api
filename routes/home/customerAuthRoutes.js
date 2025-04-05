// routes/home/customerAuthRoutes.js
const router = require('express').Router();
const {
    customer_register,
    customer_login,
    customer_logout,
    verify_email,
    resend_verification
} = require('../../controllers/home/customerAuthController');

// Authentication Routes
router.post('/customer-register', customer_register);
router.post('/customer-login', customer_login);
router.get('/customer-logout', customer_logout);

// Verification Routes
router.get('/verify-email', verify_email);
router.post('/resend-verification', resend_verification);

module.exports = router;