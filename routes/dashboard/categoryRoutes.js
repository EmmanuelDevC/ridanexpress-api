const router = require('express').Router()
const { authMiddleware } = require('../../middlewares/authMiddleware')
const categoryController = require('../../controllers/dashboard/categoryController')

router.post('/category-add', authMiddleware, categoryController.add_category)
router.get('/category-get', authMiddleware, categoryController.get_category)

// router.options('/category-delete/:id', cors(corsOptions)) // Handle preflight
// router.delete('/category-delete/:id', cors(corsOptions), authMiddleware, categoryController.delete_category
// )
module.exports = router