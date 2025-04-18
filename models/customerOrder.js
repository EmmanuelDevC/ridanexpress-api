const { Schema, model } = require('mongoose');

const customerOrderSchema = new Schema({
    customerId: {
        type: Schema.Types.ObjectId,
        required: true,
    },
    products: {
        type: Array,
        required: true
    },
    price: {
        type: Number,
        required: true,
    },
    payment_status: {
        type: String,
        required: true,
        enum: ['unpaid', 'paid', 'failed', 'refunded'],
        default: 'unpaid'
    },
    shippingInfo: {
        type: Object,
        required: true
    },
    delivery_status: {
        type: String,
        required: true,
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
        default: 'pending'
    },
    payment_date: {
        type: Date
    },
    flutterwave_ref: {
        type: String,
        unique: true,
        index: true
    },
    transaction_id: {
        type: String,
        index: true
    }
}, {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Remove the trailing "4" from model name
module.exports = model('CustomerOrder', customerOrderSchema);
