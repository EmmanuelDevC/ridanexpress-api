const router = require('express').Router()
const { authMiddleware } = require('../middlewares/authMiddleware')
const authControllers = require('../controllers/authControllers')
router.post('/admin-login', authControllers.admin_login)
router.get('/get-user', authMiddleware, authControllers.getUser)
router.post('/seller-register', authControllers.seller_register)
router.post('/seller-login', authControllers.seller_login)
router.post('/profile-image-upload', authMiddleware, authControllers.profile_image_upload)
router.post('/profile-info-add', authMiddleware, authControllers.profile_info_add)
router.post('/verify-token', authMiddleware, authControllers.verify_token);
router.post('/refresh-token', authMiddleware, authControllers.refresh_token)
router.post('/create-inquiry', authMiddleware, authControllers.create_inquiry);
router.post('/persona-webhook', authControllers.persona_webhook);

router.get('/logout', authMiddleware, authControllers.logout)

module.exports = router