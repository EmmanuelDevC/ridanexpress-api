const router = require('express').Router();
const sendVerificationEmail = require('../utiles/emailSender');
const crypto = require('crypto');

router.post('/test-email', async (req, res) => {
    try {
        const token = crypto.randomBytes(20).toString('hex');
        await sendVerificationEmail('test@example.com', token);
        res.json({ 
            success: true,
            message: 'Test email sent successfully',
            token: token
        });
    } catch (error) {
        console.error('Email Test Error:', error);
        res.status(500).json({ 
            error: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

module.exports = router;