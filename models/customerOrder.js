const { Schema, model } = require('mongoose')

const customerOrder = new Schema({
    customerId: {
        type: Schema.ObjectId,
        required: true
    },
    products: {
        type: Array,
        required: true
    },
    price: {
        type: Number,
        required: true
    },
    payment_status: {
        type: String,
        required: true
    },
    shippingInfo: {
        type: Object,
        required: true
    },
    flutterwave_ref: {
        type: String,
        unique: true,
        sparse: true // Allows multiple nulls
    },
    delivery_status: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { timestamps: true })

module.exports = model('customerOrders', customerOrder)