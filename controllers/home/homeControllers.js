const categoryModel = require('../../models/categoryModel');
const productModel = require('../../models/productModel');
const queryProducts = require('../../utiles/queryProducts');
const reviewModel = require('../../models/reviewModel');
const moment = require('moment');
const { mongo: { ObjectId } } = require('mongoose');
const { responseReturn } = require('../../utiles/response');

class homeControllers {
    formateProduct = (products) => {
        const productArray = [];
        let i = 0;
        while (i < products.length) {
            let temp = []
            let j = i
            while (j < i + 3) {
                if (products[j]) {
                    temp.push(products[j])
                }
                j++
            }
            productArray.push([...temp])
            i = j
        }
        return productArray
    }

    get_categorys = async (req, res) => {
        try {
            const categorys = await categoryModel.find({})
            responseReturn(res, 200, { categorys })
        } catch (error) {
            console.log(error.message)
        }
    }

    get_products = async (req, res) => {
        try {
            // Only show approved products to customers
            const approvedFilter = { status: 'approved' };

            const products = await productModel.find(approvedFilter).limit(16).sort({ createdAt: -1 });

            // Only approved products for all sections
            const allProduct1 = await productModel.find(approvedFilter).limit(9).sort({ createdAt: -1 });
            const latest_product = this.formateProduct(allProduct1);

            const allProduct2 = await productModel.find(approvedFilter).limit(9).sort({ rating: -1 });
            const topRated_product = this.formateProduct(allProduct2);

            const allProduct3 = await productModel.find(approvedFilter).limit(9).sort({ discount: -1 });
            const discount_product = this.formateProduct(allProduct3);

            responseReturn(res, 200, {
                products,
                latest_product,
                topRated_product,
                discount_product
            })
        } catch (error) {
            console.log(error.message)
        }
    }

    get_admin_products = async (req, res) => {
        try {
            // Admin can see all products regardless of status
            const products = await productModel.find({}).limit(16).sort({ createdAt: -1 });

            const allProduct1 = await productModel.find({}).limit(9).sort({ createdAt: -1 });
            const latest_product = this.formateProduct(allProduct1);

            const allProduct2 = await productModel.find({}).limit(9).sort({ rating: -1 });
            const topRated_product = this.formateProduct(allProduct2);

            const allProduct3 = await productModel.find({}).limit(9).sort({ discount: -1 });
            const discount_product = this.formateProduct(allProduct3);

            responseReturn(res, 200, {
                products,
                latest_product,
                topRated_product,
                discount_product
            })
        } catch (error) {
            console.log(error.message)
        }
    }

    get_product = async (req, res) => {
        const { slug } = req.params;
        try {
            // Only show approved products to customers
            const product = await productModel.findOne({
                slug,
                status: 'approved'
            });

            if (!product) {
                return responseReturn(res, 404, { error: 'Product not found' });
            }

            // Only approved related products
            const approvedFilter = { status: 'approved' };

            const relatedProducts = await productModel.find({
                ...approvedFilter,
                _id: { $ne: product.id },
                category: product.category
            }).limit(20);

            const moreProducts = await productModel.find({
                ...approvedFilter,
                _id: { $ne: product.id },
                sellerId: product.sellerId
            }).limit(3);

            responseReturn(res, 200, {
                product,
                relatedProducts,
                moreProducts
            })
        } catch (error) {
            console.log(error.message)
        }
    }

    get_product_by_id = async (req, res) => {
        const { id } = req.params;
        try {
            // Only show approved products to customers
            const product = await productModel.findOne({
                _id: id,
                status: 'approved'
            });

            if (!product) {
                return responseReturn(res, 404, { error: 'Product not found' });
            }

            // Only approved related products
            const approvedFilter = { status: 'approved' };

            const relatedProducts = await productModel.find({
                ...approvedFilter,
                _id: { $ne: product.id },
                category: product.category
            }).limit(20);

            const moreProducts = await productModel.find({
                ...approvedFilter,
                _id: { $ne: product.id },
                sellerId: product.sellerId
            }).limit(3);

            responseReturn(res, 200, {
                product,
                relatedProducts,
                moreProducts
            })
        } catch (error) {
            console.log(error.message)
            responseReturn(res, 500, { error: 'Server error' })
        }
    }

    price_range_product = async (req, res) => {
        try {
            const priceRange = { low: 0, high: 0 };

            // Only approved products
            const approvedFilter = { status: 'approved' };

            const products = await productModel.find(approvedFilter).limit(9).sort({ createdAt: -1 });
            const latest_product = this.formateProduct(products);

            const getForPrice = await productModel.find(approvedFilter).sort({ 'price': 1 });

            if (getForPrice.length > 0) {
                priceRange.high = getForPrice[getForPrice.length - 1].price;
                priceRange.low = getForPrice[0].price;
            }

            responseReturn(res, 200, {
                latest_product,
                priceRange
            })
        } catch (error) {
            console.log(error.message)
        }
    }

    query_products = async (req, res) => {
        const parPage = 12;
        req.query.parPage = parPage;

        try {
            // Only approved products
            const products = await productModel.find({ status: 'approved' }).sort({ createdAt: -1 });

            const totalProduct = new queryProducts(products, req.query)
                .categoryQuery()
                .searchQuery()
                .priceQuery()
                .ratingQuery()
                .sortByPrice()
                .countProducts();

            const result = new queryProducts(products, req.query)
                .categoryQuery()
                .searchQuery()
                .ratingQuery()
                .priceQuery()
                .sortByPrice()
                .skip()
                .limit()
                .getProducts();

            responseReturn(res, 200, {
                products: result,
                totalProduct,
                parPage
            })
        } catch (error) {
            console.log(error.message)
        }
    }

    search_suggestions = async (req, res) => {
        try {
            const { query } = req.query;

            // Return empty for short queries
            if (!query || query.trim().length < 2) {
                return res.json({ success: true, suggestions: [] });
            }

            // Use MongoDB text search with index
            const products = await productModel.find(
                {
                    status: 'approved',
                    $text: { $search: query }
                },
                {
                    score: { $meta: "textScore" },
                    _id: 0,
                    name: 1
                }
            )
                .sort({ score: { $meta: "textScore" } })
                .limit(5)
                .lean();

            const suggestions = products.map(p => p.name);

            res.json({ success: true, suggestions });
        } catch (error) {
            console.error('Search error:', error);
            res.status(500).json({ success: false, suggestions: [], error: 'Server error' });
        }
    };

    submit_review = async (req, res) => {
        const { name, rating, review, productId } = req.body;
        try {
            await reviewModel.create({
                productId,
                name,
                rating,
                review,
                date: moment(Date.now()).format('LL')
            });

            let rat = 0;
            const reviews = await reviewModel.find({ productId });
            for (let i = 0; i < reviews.length; i++) {
                rat = rat + reviews[i].rating;
            }

            let productRating = 0;
            if (reviews.length !== 0) {
                productRating = (rat / reviews.length).toFixed(1);
            }

            await productModel.findByIdAndUpdate(productId, {
                rating: productRating
            });

            responseReturn(res, 201, { message: "Review Success" });
        } catch (error) {
            console.log(error);
            responseReturn(res, 500, { error: 'Failed to submit review' });
        }
    }

    get_reviews = async (req, res) => {
        const { productId } = req.params;
        let { pageNo } = req.query;
        pageNo = parseInt(pageNo);
        const limit = 5;
        const skipPage = limit * (pageNo - 1);

        try {
            let getRating = await reviewModel.aggregate([
                {
                    $match: {
                        productId: { $eq: new ObjectId(productId) },
                        rating: { $exists: true, $ne: null }
                    }
                },
                {
                    $group: {
                        _id: "$rating",
                        count: { $sum: 1 }
                    }
                }
            ]);

            let rating_review = [
                { rating: 5, sum: 0 },
                { rating: 4, sum: 0 },
                { rating: 3, sum: 0 },
                { rating: 2, sum: 0 },
                { rating: 1, sum: 0 }
            ];

            for (let i = 0; i < rating_review.length; i++) {
                const found = getRating.find(r => r._id === rating_review[i].rating);
                if (found) {
                    rating_review[i].sum = found.count;
                }
            }

            const getAll = await reviewModel.find({ productId });
            const reviews = await reviewModel.find({ productId })
                .skip(skipPage)
                .limit(limit)
                .sort({ createdAt: -1 });

            responseReturn(res, 200, {
                reviews,
                totalReview: getAll.length,
                rating_review
            });
        } catch (error) {
            console.log(error);
            responseReturn(res, 500, { error: 'Failed to get reviews' });
        }
    }
}

module.exports = new homeControllers();