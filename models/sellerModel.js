const { Schema, model } = require('mongoose')

const sellerSchema = new Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true,
        select: false
    },
    role: {
        type: String,
        default: 'seller'
    },
    status: {
        type: String,
        default: 'pending'
    },
    payment: {
        type: String,
        default: 'inactive'
    },
    flutterwaveDetails: {
        subaccountId: String,
        recipientId: String,
        accountNumber: String,
        bankCode: String,
        bankName: String,
        recipientVerified: Boolean,
        currency: {
            type: String,
            default: 'NGN'
        }
    },
    method: {
        type: String,
        required: true,
    },
    image: {
        type: String,
        default: ''
    },
    shopInfo: {
        shopName: String,
        division: String,
        district: String,
        sub_district: String,
        businessType: {
            type: String,
            enum: ['small', 'registered'],
            default: 'small'
        },
        cacNumber: String,
        companyName: String,
        companyEmail: String,
        tin: String,
        postalCode: String,
        documentType: String,
        document: String,
        id_number: String, // ADDED ID NUMBER FIELD
        documentVerification: {
            status: {
                type: String,
                enum: ['pending', 'verified', 'manual_review', 'failed', 'error'],
                default: 'pending'
            },
            checks: [String],
            issues: [String],
            lastVerified: Date
        }
    }
}, { timestamps: true })

sellerSchema.index({
    name: 'text',
    email: 'text'
}, {
    weights: {
        name: 5,
        email: 4,
    }
})

module.exports = model('sellers', sellerSchema)