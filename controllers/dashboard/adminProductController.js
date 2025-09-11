const productModel = require('../../models/productModel');
const { responseReturn } = require('../../utiles/response');

module.exports = {
    getPendingProducts: async (req, res) => {
        const { page, parPage } = req.query;
        const skipPage = parseInt(parPage) * (parseInt(page) - 1);

        try {
            const products = await productModel.find({ status: 'pending' })
                .populate('sellerId', 'shopName email') // Fixed populate syntax
                .skip(skipPage)
                .limit(parseInt(parPage))
                .sort({ createdAt: -1 });

            const totalProducts = await productModel.countDocuments({ status: 'pending' }); // More efficient
            responseReturn(res, 200, { totalProducts, products });
        } catch (error) {
            console.error('Error fetching pending products:', error); // Add logging
            responseReturn(res, 500, { error: 'Server error' });
        }
    },

    approveProduct: async (req, res) => {
        const { productId } = req.params;

        try {
            await productModel.findByIdAndUpdate(productId, { status: 'approved' });
            responseReturn(res, 200, { message: 'Product approved successfully' });
        } catch (error) {
            responseReturn(res, 500, { error: error.message });
        }
    },

    rejectProduct: async (req, res) => {
        const { productId } = req.params;
        const { reason } = req.body;

        try {
            await productModel.findByIdAndUpdate(productId, {
                status: 'rejected',
                rejectionReason: reason
            });
            responseReturn(res, 200, { message: 'Product rejected successfully' });
        } catch (error) {
            responseReturn(res, 500, { error: error.message });
        }
    },

    getProductDetails: async (req, res) => {
        const { productId } = req.params;

        try {
            const product = await productModel.findById(productId)
                .populate('sellerId', 'shopName email phone');

            if (!product) {
                return responseReturn(res, 404, { error: 'Product not found' });
            }

            responseReturn(res, 200, { product });
        } catch (error) {
            responseReturn(res, 500, { error: error.message });
        }
    }
}