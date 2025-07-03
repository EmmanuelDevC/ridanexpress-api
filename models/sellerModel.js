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


// const { Schema, model } = require('mongoose')
// const encryptPlugin = require('mongoose-encryption')

// const sellerSchema = new Schema({
//     name: {
//         type: String,
//         required: true
//     },
//     email: {
//         type: String,
//         required: true,
//         unique: true,
//         index: true
//     },
//     password: {
//         type: String,
//         required: true,
//         select: false
//     },
//     role: {
//         type: String,
//         default: 'seller'
//     },
//     status: {
//         type: String,
//         enum: ['pending', 'active', 'suspended', 'under_review'],
//         default: 'pending'
//     },
//     payment: {
//         type: String,
//         enum: ['inactive', 'active', 'restricted'],
//         default: 'inactive'
//     },
//     flutterwaveDetails: {
//         subaccountId: {
//             type: String,
//             select: false
//         },
//         recipientId: {
//             type: String,
//             select: false
//         },
//         accountNumber: {
//             type: String,
//             select: false
//         },
//         bankCode: {
//             type: String,
//             select: false
//         },
//         bankName: String,
//         recipientVerified: Boolean,
//         currency: {
//             type: String,
//             default: 'NGN'
//         }
//     },
//     method: {
//         type: String,
//         required: true,
//     },
//     image: {
//         type: String,
//         default: ''
//     },
//     shopInfo: {
//         shopName: String,
//         division: String,
//         district: String,
//         sub_district: String,
//         businessType: {
//             type: String,
//             enum: ['small', 'registered'],
//             default: 'small'
//         },
//         cacNumber: {
//             type: String,
//             select: false // Hide sensitive data
//         },
//         companyName: String,
//         companyEmail: String,
//         tin: {
//             type: String,
//             select: false // Hide sensitive data
//         },
//         postalCode: String,
//         documentType: String,
//         document: {
//             type: String,
//             select: false // Hide sensitive data
//         },
//         id_number: {
//             type: String,
//             select: false // Hide sensitive data
//         },
//         documentVerification: {
//             status: {
//                 type: String,
//                 enum: ['pending', 'verified', 'manual_review', 'failed', 'error', 'expired'],
//                 default: 'pending'
//             },
//             checks: [String],
//             issues: [String],
//             lastVerified: Date,
//             verificationId: String, // Dojah verification ID
//             attempts: {
//                 type: Number,
//                 default: 0
//             }
//         },
//         documentExpiration: Date // Track document expiry
//     },
//     security: {
//         lastDocumentUpload: Date,
//         documentUploadCount: {
//             type: Number,
//             default: 0
//         },
//         verificationHistory: [{
//             timestamp: Date,
//             status: String,
//             service: String // 'dojah' or 'manual'
//         }]
//     }
// }, {
//     timestamps: true,
//     toJSON: { virtuals: true },
//     toObject: { virtuals: true }
// })

// // Add virtual for verification status
// sellerSchema.virtual('verificationStatus').get(function () {
//     return this.shopInfo.documentVerification.status
// })

// // Add virtual for business type
// sellerSchema.virtual('businessType').get(function () {
//     return this.shopInfo.businessType
// })

// // Add index for verification status and business type
// sellerSchema.index({
//     'shopInfo.documentVerification.status': 1,
//     'shopInfo.businessType': 1,
//     status: 1
// })

// // Add full-text search index
// sellerSchema.index({
//     name: 'text',
//     email: 'text',
//     'shopInfo.shopName': 'text',
//     'shopInfo.companyName': 'text'
// }, {
//     weights: {
//         name: 5,
//         email: 4,
//         'shopInfo.shopName': 6,
//         'shopInfo.companyName': 5
//     },
//     name: 'seller_search_index'
// })

// // Encryption configuration
// const encKey = Buffer.from(process.env.ENCRYPTION_KEY, 'base64')
// const sigKey = Buffer.from(process.env.SIGNATURE_KEY, 'base64')

// // Apply encryption to sensitive fields
// sellerSchema.plugin(encryptPlugin, {
//     encryptionKey: encKey,
//     signingKey: sigKey,
//     encryptedFields: [
//         'password',
//         'flutterwaveDetails',
//         'shopInfo.cacNumber',
//         'shopInfo.tin',
//         'shopInfo.document',
//         'shopInfo.id_number'
//     ],
//     excludeFromEncryption: ['_id', 'email', 'createdAt', 'updatedAt']
// })

// module.exports = model('sellers', sellerSchema)