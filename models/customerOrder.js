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
    delivery_status: {
        type: String,
        required: true
    },
    date: {
        type: String,
        required: true
    },
    flutterwave_ref: {
        type: String,
        unique: true
    }
}, { timestamps: true })

module.exports = model('customerOrders', customerOrder)