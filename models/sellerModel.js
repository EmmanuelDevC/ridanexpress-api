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

    location: {
        address: String,
        city: String,
        state: String,
        country: {
            type: String,
            default: 'Nigeria'
        },
        businessNumber: Number,
        // CHANGE TO GEOJSON FORMAT:
        coordinates: {
            type: {
                type: String,
                enum: ['Point'],
                default: 'Point'
            },
            coordinates: {
                type: [Number], // [longitude, latitude]
                default: [0, 0]
            }
        },
        geocodingSource: {
            type: String,
            enum: [
                'mapbox',
                'browser_geolocation',
                'manual',
                'mapbox_autocomplete',
                'mapbox_search',
                'mapbox_suggestion'
            ],
            default: 'manual'
        }
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
        businessNumber: String,
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

// Keep the 2dsphere index - it will work with GeoJSON format
sellerSchema.index({
    'location.coordinates': '2dsphere'
}, {
    sparse: true
});

module.exports = model('sellers', sellerSchema)