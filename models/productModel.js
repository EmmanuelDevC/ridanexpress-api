const { Schema, model } = require('mongoose')

const productSchema = new Schema({
    sellerId: {
        type: Schema.ObjectId,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    slug: {
        type: String,
        required: true
    },
    category: {
        type: String,
        required: true
    },
    brand: {
        type: String,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    stock: {
        type: Number,
        required: true
    },
    discount: {
        type: Number,
        required: true
    },

    description: {
        type: String,
        required: true
    },
    shopName: {
        type: String,
        required: true
    },
    images: {
        type: Array,
        required: true
    },
    rating: {
        type: Number,
        default: 0
    }
}, { timestamps: true })

productSchema.index({
    name: 'text',
    description: 'text',
    category: 'text',
    tags: 'text'
}, {
    name: 'search_index',
    weights: {
        name: 4,
        category: 3,
        tags: 2,
        description: 1
    }
})

module.exports = model('products', productSchema)