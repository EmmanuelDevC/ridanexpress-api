const categoryModel = require('../../models/categoryModel')
const { responseReturn } = require('../../utiles/response')
const cloudinary = require('cloudinary').v2
const formidable = require('formidable')
const slugify = require('slugify');


class categoryController {

    add_category = async (req, res) => {
        const form = formidable();
        form.parse(req, async (err, fields, files) => {
            if (err) {
                return responseReturn(res, 404, { error: 'Something went wrong' });
            }

            const { name, subcategories } = fields;
            const { image } = files;

            if (!name || !image) {
                return responseReturn(res, 400, {
                    error: 'Name and image are required'
                });
            }

            // Generate slug from name
            const slug = slugify(name, { lower: true, strict: true });

            // Process subcategories
            const subcategoriesArray = Array.isArray(subcategories)
                ? subcategories
                : JSON.parse(subcategories || '[]');

            if (subcategoriesArray.length > 10) {
                return responseReturn(res, 400, {
                    error: 'Maximum 10 subcategories allowed'
                });
            }

            cloudinary.config({
                cloud_name: process.env.cloud_name,
                api_key: process.env.api_key,
                api_secret: process.env.api_secret,
                secure: true
            });

            try {
                const result = await cloudinary.uploader.upload(image.filepath, {
                    folder: 'categorys',
                    allowed_formats: ['jpg', 'png', 'gif', 'webp']
                });

                if (result) {
                    const category = await categoryModel.create({
                        name,
                        slug,
                        image: result.url,
                        subcategories: subcategoriesArray
                            .map(s => s.trim())
                            .filter(s => s)
                    });

                    return responseReturn(res, 201, {
                        category,
                        message: 'Category added successfully'
                    });
                } else {
                    return responseReturn(res, 404, { error: 'Image upload failed' });
                }
            } catch (error) {
                console.error('Category Error:', error);
                const statusCode = error.message && error.message.includes('duplicate') ? 409 : 500;
                const message = error.message && error.message.includes('duplicate')
                    ? 'Category name already exists'
                    : 'Internal server error';

                return responseReturn(res, statusCode, { error: message });
            }
        });
    };

    // delete_category = async (req, res) => {
    //     try {
    //         const { id } = req.params;

    //         const deletedCategory = await Category.findByIdAndDelete(id);

    //         if (!deletedCategory) {
    //             return res.status(404).json({
    //                 message: "Category not found",
    //                 success: false
    //             });
    //         }

    //         res.status(200).json({
    //             message: "Category deleted successfully",
    //             success: true,
    //             categoryId: id
    //         });

    //     } catch (err) {
    //         res.status(500).json({
    //             message: err.message,
    //             success: false
    //         });
    //     }
    // }

    get_category = async (req, res) => {
        const { page, searchValue, parPage } = req.query
        try {
            let skipPage = ''
            if (parPage && page) {
                skipPage = parseInt(parPage) * (parseInt(page) - 1)
            }
            if (searchValue && page && parPage) {
                const categorys = await categoryModel.find({
                    $text: { $search: searchValue }
                }).skip(skipPage).limit(parPage).sort({ createdAt: -1 })
                const totalCategory = await categoryModel.find({
                    $text: { $search: searchValue }
                }).countDocuments()
                responseReturn(res, 200, { totalCategory, categorys })
            }
            else if (searchValue === '' && page && parPage) {
                const categorys = await categoryModel.find({}).skip(skipPage).limit(parPage).sort({ createdAt: -1 })
                const totalCategory = await categoryModel.find({}).countDocuments()
                responseReturn(res, 200, { totalCategory, categorys })
            }
            else {
                const categorys = await categoryModel.find({}).sort({ createdAt: -1 })
                const totalCategory = await categoryModel.find({}).countDocuments()
                responseReturn(res, 200, { totalCategory, categorys })
            }
        } catch (error) {
            console.log(error.message)
        }
    }
}

module.exports = new categoryController()