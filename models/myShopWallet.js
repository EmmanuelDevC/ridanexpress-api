const { Schema, model } = require('mongoose');

const myShopWalletSchema = new Schema({
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

// Remove the trailing "4" and use PascalCase for model name
module.exports = model('MyShopWallet', myShopWalletSchema);