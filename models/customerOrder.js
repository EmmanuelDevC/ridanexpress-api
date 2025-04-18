const { Schema, model } = require('mongoose');

const customerOrderSchema = new Schema({
    customerId: {
        type: Schema.Types.ObjectId,
        required: true,
        ref: 'User'  // Reference to user model
    },
    products: {
        type: [{
            productId: {
                type: Schema.Types.ObjectId,
                required: true,
                ref: 'Product'
            },
            name: String,
            quantity: Number,
            price: Number,
            images: [String]
        }],
        required: true
    },
    price: {
        type: Number,
        required: true,
        min: [0, 'Price cannot be negative']
    },
    currency: {
        type: String,
        required: true,
        default: 'NGN',
        enum: ['NGN'] // Add other currencies if needed
    },
    payment_status: {
        type: String,
        required: true,
        enum: ['unpaid', 'paid', 'failed', 'refunded'],
        default: 'unpaid'
    },
    shippingInfo: {
        address: {
            type: String,
            required: true
        },
        city: {
            type: String,
            required: true
        },
        phone: {
            type: String,
            required: true
        }
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