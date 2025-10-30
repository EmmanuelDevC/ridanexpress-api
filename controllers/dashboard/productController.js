const formidable = require('formidable')
const cloudinary = require('cloudinary').v2
const productModel = require('../../models/productModel');
const { responseReturn } = require('../../utiles/response');

class productController {
    add_product = async (req, res) => {
        const { id } = req;
        const form = formidable({ multiples: true })

        form.parse(req, async (err, field, files) => {
            let {
                name,
                category,
                description,
                stock,
                price,
                discount,
                shopName,
                brand,
                weight,
                length,
                width,
                height
            } = field;

            weight = Array.isArray(weight) ? weight[0] : weight;
            length = Array.isArray(length) ? length[0] : length;
            width = Array.isArray(width) ? width[0] : width;
            height = Array.isArray(height) ? height[0] : height;
            
            const { images } = files;
            name = name.trim()
            name = name.replace(/[^a-zA-Z0-9\s-]/g, '')
            const slug = name.split(' ').join('-')

            cloudinary.config({
                cloud_name: process.env.cloud_name,
                api_key: process.env.api_key,
                api_secret: process.env.api_secret,
                secure: true
            })

            try {
                let allImageUrl = [];

                for (let i = 0; i < images.length; i++) {
                    const result = await cloudinary.uploader.upload(images[i].filepath, { folder: 'products' })
                    allImageUrl = [...allImageUrl, result.url]
                }

                await productModel.create({
                    sellerId: id,
                    name,
                    slug,
                    shopName,
                    category: category.trim(),
                    description: description.trim(),
                    stock: parseInt(stock) || 0,
                    price: parseInt(price) || 0,
                    discount: parseInt(discount) || 0,
                    images: allImageUrl,
                    brand: brand.trim(),
                    status: 'pending',
                    weight: weight ? parseFloat(weight) : 0,
                    length: length ? parseFloat(length) : 0,
                    width: width ? parseFloat(width) : 0,
                    height: height ? parseFloat(height) : 0
                })
                responseReturn(res, 201, { message: "Product submitted for Ridan approval" })
            } catch (error) {
                responseReturn(res, 500, { error: error.message })
            }
        })
    }

    get_pending_products = async (req, res) => {
        const { page, parPage } = req.query;
        const skipPage = parseInt(parPage) * (parseInt(page) - 1);

        try {
            const products = await productModel.find({ status: 'pending' })
                .populate('sellerId', 'shopName email')
                .skip(skipPage)
                .limit(parseInt(parPage))
                .sort({ createdAt: -1 });

            const totalProducts = await productModel.countDocuments({ status: 'pending' });
            responseReturn(res, 200, { totalProducts, products });
        } catch (error) {
            console.error('Error fetching pending products:', error);
            responseReturn(res, 500, { error: 'Server error' });
        }
    }

    approve_product = async (req, res) => {
        const { productId } = req.params;

        try {
            await productModel.findByIdAndUpdate(productId, { status: 'approved' });
            responseReturn(res, 200, { message: 'Product approved successfully' });
        } catch (error) {
            responseReturn(res, 500, { error: error.message });
        }
    }

    reject_product = async (req, res) => {
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
    }

    products_get = async (req, res) => {
        const { page, searchValue, parPage } = req.query
        const { id } = req;

        const skipPage = parseInt(parPage) * (parseInt(page) - 1);

        try {
            if (searchValue) {
                const products = await productModel.find({
                    $text: { $search: searchValue },
                    sellerId: id,
                    status: { $in: ['pending', 'approved', 'rejected'] }
                }).skip(skipPage).limit(parPage).sort({ createdAt: -1 })
                const totalProduct = await productModel.find({
                    $text: { $search: searchValue },
                    sellerId: id,
                    status: { $in: ['pending', 'approved', 'rejected'] }
                }).countDocuments()
                responseReturn(res, 200, { totalProduct, products })
            } else {
                const products = await productModel.find({
                    sellerId: id,
                    status: { $in: ['pending', 'approved', 'rejected'] }
                }).skip(skipPage).limit(parPage).sort({ createdAt: -1 })
                const totalProduct = await productModel.find({
                    sellerId: id,
                    status: { $in: ['pending', 'approved', 'rejected'] }
                }).countDocuments()
                responseReturn(res, 200, { totalProduct, products })
            }
        } catch (error) {
            console.log(error.message)
        }
    }

    product_get = async (req, res) => {
        const { productId } = req.params;
        try {
            const product = await productModel.findById(productId)
            responseReturn(res, 200, { product })
        } catch (error) {
            console.log(error.message)
        }
    }

    product_update = async (req, res) => {
        let { name, description, discount, price, brand, productId, stock, weight, length, width, height } = req.body;
        name = name.trim()
        name = name.replace(/[^a-zA-Z0-9\s-]/g, '')
        const slug = name.split(' ').join('-')

        try {
            await productModel.findByIdAndUpdate(productId, {
                name,
                description,
                discount: parseInt(discount),
                price: parseInt(price),
                brand,
                stock: parseInt(stock),
                slug,
                weight: parseFloat(weight),
                length: parseFloat(length),
                width: parseFloat(width),
                height: parseFloat(height),
                status: 'pending'
            })
            const product = await productModel.findById(productId)
            responseReturn(res, 200, { product, message: 'product update success' })
        } catch (error) {
            responseReturn(res, 500, { error: error.message })
        }
    }

    product_image_update = async (req, res) => {
        const form = formidable({ multiples: true })

        form.parse(req, async (err, field, files) => {
            const { productId, oldImage } = field;
            const { newImage } = files

            if (err) {
                responseReturn(res, 404, { error: err.message })
            } else {
                try {
                    cloudinary.config({
                        cloud_name: process.env.cloud_name,
                        api_key: process.env.api_key,
                        api_secret: process.env.api_secret,
                        secure: true
                    })
                    const result = await cloudinary.uploader.upload(newImage.filepath, { folder: 'products' })

                    if (result) {
                        let { images } = await productModel.findById(productId)
                        const index = images.findIndex(img => img === oldImage)
                        images[index] = result.url;

                        await productModel.findByIdAndUpdate(productId, {
                            images
                        })

                        const product = await productModel.findById(productId)
                        responseReturn(res, 200, { product, message: 'product image update success' })
                    } else {
                        responseReturn(res, 404, { error: 'image upload failed' })
                    }
                } catch (error) {
                    responseReturn(res, 404, { error: error.message })
                }
            }
        })
    }
}

module.exports = new productController()