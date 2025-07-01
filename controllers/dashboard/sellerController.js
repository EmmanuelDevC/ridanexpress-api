const mongoose = require('mongoose');
const sellerModel = require('../../models/sellerModel');
const Product = require('../../models/productModel');
const { responseReturn } = require('../../utiles/response');

class sellerController {
    // Validate MongoDB ID format
    validateObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

    // Get seller requests
    get_seller_request = async (req, res) => {
        const { page = 1, searchValue, parPage = 10 } = req.query;
        const skipPage = parseInt(parPage) * (parseInt(page) - 1);

        try {
            let query = { status: 'pending' };
            if (searchValue) {
                query = {
                    ...query,
                    $text: { $search: searchValue }
                };
            }

            const [sellers, totalSeller] = await Promise.all([
                sellerModel.find(query)
                    .skip(skipPage)
                    .limit(parseInt(parPage))
                    .sort({ createdAt: -1 })
                    .lean(),
                sellerModel.countDocuments(query)
            ]);

            responseReturn(res, 200, { totalSeller, sellers });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error fetching seller requests'
            });
        }
    }

    // Get single seller
    get_seller = async (req, res) => {
        const { sellerId } = req.params;

        try {
            if (!this.validateObjectId(sellerId)) {
                return responseReturn(res, 400, { error: 'Invalid seller ID format' });
            }

            const seller = await sellerModel.findById(sellerId).lean();
            if (!seller) {
                return responseReturn(res, 404, { error: 'Seller not found' });
            }

            responseReturn(res, 200, { seller });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error fetching seller'
            });
        }
    }

    // Get seller products
    get_seller_products = async (req, res) => {
        try {
            const { sellerId } = req.params;
            let { page = 1, parPage = 12 } = req.query;

            // Validate inputs
            page = Math.max(1, parseInt(page));
            parPage = Math.max(1, parseInt(parPage));

            if (!this.validateObjectId(sellerId)) {
                return responseReturn(res, 400, { error: 'Invalid seller ID format' });
            }

            const [products, totalProducts] = await Promise.all([
                Product.find({ sellerId })
                    .skip((page - 1) * parPage)
                    .limit(parPage)
                    .sort({ createdAt: -1 })
                    .select('name price images discount rating stock slug category createdAt')
                    .lean(),
                Product.countDocuments({ sellerId })
            ]);

            responseReturn(res, 200, {
                products,
                totalProducts,
                currentPage: page,
                parPage
            });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error fetching seller products'
            });
        }
    }

    // Get seller details
    get_seller_details = async (req, res) => {
        try {
            const { sellerId } = req.params;

            if (!this.validateObjectId(sellerId)) {
                return responseReturn(res, 400, { error: 'Invalid seller ID format' });
            }

            const [seller, totalProducts] = await Promise.all([
                sellerModel.findById(sellerId)
                    .select('name image shopInfo createdAt')
                    .lean()
                    .then(res => res || Promise.reject(new Error('Seller not found'))),
                Product.countDocuments({ sellerId })
            ]);

            responseReturn(res, 200, {
                seller: { ...seller, totalProducts }
            });
        } catch (error) {
            const statusCode = error.message === 'Seller not found' ? 404 : 500;
            responseReturn(res, statusCode, {
                error: statusCode === 404
                    ? error.message
                    : 'Server error fetching seller details'
            });
        }
    }

    // Update seller status
    seller_status_update = async (req, res) => {
        const { sellerId, status } = req.body;

        try {
            if (!this.validateObjectId(sellerId)) {
                return responseReturn(res, 400, { error: 'Invalid seller ID format' });
            }

            const updatedSeller = await sellerModel.findByIdAndUpdate(
                sellerId,
                { status },
                { new: true, runValidators: true }
            );

            if (!updatedSeller) {
                return responseReturn(res, 404, { error: 'Seller not found' });
            }

            responseReturn(res, 200, {
                seller: updatedSeller,
                message: 'Seller status updated successfully'
            });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error updating seller status'
            });
        }
    }

    // Get active sellers
    get_active_sellers = async (req, res) => {
        try {
            const { page = 1, searchValue, parPage = 10 } = req.query;
            const skipPage = parPage * (page - 1);

            let query = { status: 'active' };
            if (searchValue) {
                query.$text = { $search: searchValue };
            }

            const [sellers, totalSeller] = await Promise.all([
                sellerModel.find(query)
                    .skip(skipPage)
                    .limit(parPage)
                    .sort({ createdAt: -1 })
                    .lean(),
                sellerModel.countDocuments(query)
            ]);

            responseReturn(res, 200, { totalSeller, sellers });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error fetching active sellers'
            });
        }
    }

    // Get deactivated sellers
    get_deactive_sellers = async (req, res) => {
        try {
            const { page = 1, searchValue, parPage = 10 } = req.query;
            const skipPage = parPage * (page - 1);

            let query = { status: 'deactive' };
            if (searchValue) {
                query.$text = { $search: searchValue };
            }

            const [sellers, totalSeller] = await Promise.all([
                sellerModel.find(query)
                    .skip(skipPage)
                    .limit(parPage)
                    .sort({ createdAt: -1 })
                    .lean(),
                sellerModel.countDocuments(query)
            ]);

            responseReturn(res, 200, { totalSeller, sellers });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error fetching deactivated sellers'
            });
        }
    }
}

module.exports = new sellerController();