const router = require('express').Router()
const homeControllers = require('../../controllers/home/homeControllers')

router.get('/products', async (req, res) => {
    try {
        const products = await productModel.find({ status: 'approved' });
        res.json(products);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
router.get('/get-categorys', homeControllers.get_categorys)
router.get('/get-products', homeControllers.get_products)
router.get('/get-product-by-id/:id', homeControllers.get_product_by_id);
router.get('/get-product/:slug', homeControllers.get_product)
router.get('/price-range-latest-product', homeControllers.price_range_product)
router.get('/query-products', homeControllers.query_products)
router.get('/search-suggestions', homeControllers.search_suggestions);

//admin routes
router.get('/get-admin-products', homeControllers.get_admin_products)

router.post('/customer/submit-review', homeControllers.submit_review)
router.get('/customer/get-reviews/:productId', homeControllers.get_reviews)


module.exports = router