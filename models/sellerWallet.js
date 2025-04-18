const { Schema, model } = require('mongoose');

const sellerWalletSchema = new Schema({
    sellerId: {
        type: Schema.Types.ObjectId,  // Changed from String to ObjectId
        ref: 'User',                  // Reference to user model
        required: true,
        index: true
    },
    amount: {
        type: Number,
        required: true,
        min: [0, 'Amount cannot be negative']
    },
    month: {  // Fixed typo from "manth" to "month"
        type: Number,
        required: true,
        min: [1, 'Invalid month'],
        max: [12, 'Invalid month']
    },
    year: {
        type: Number,
        required: true,
        min: [2020, 'Invalid year']
    },
    orderId: {
        type: Schema.Types.ObjectId,
        ref: 'CustomerOrder',
        index: true
    },
    transactionId: {
        type: String,
        index: true
    },
    currency: {
        type: String,
        default: 'NGN',
        enum: ['NGN'] // Add other currencies if needed
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Proper model name casing
module.exports = model('SellerWallet', sellerWalletSchema);