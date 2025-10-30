const { Schema, model } = require('mongoose');

const authOrderSchema = new Schema({
  orderId: {
    type: Schema.ObjectId,
    required: true
  },
  sellerId: {
    type: Schema.ObjectId,
    required: true
  },
  products: [{
    productId: { type: Schema.ObjectId, required: true },
    name: { type: String, required: true },
    brand: { type: String, required: true },
    images: { type: [String], required: true },
    price: { type: Number, required: true },
    discount: { type: Number, required: true }, // Added discount field
    quantity: { type: Number, required: true },
    // ADDED ALL IMPORTANT PRODUCT FIELDS
    weight: { type: Number, required: true }, // in kg
    length: { type: Number, required: true }, // in cm
    width: { type: Number, required: true },  // in cm
    height: { type: Number, required: true }, // in cm
    category: { type: String, required: true },
    description: { type: String, required: true },
    shopName: { type: String, required: true },
    stock: { type: Number, required: true }
  }],
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
  delivery: {
    provider: { type: String, enum: ['self', 'kwik', 'standard'], default: 'self' },
    kwikOrderId: String,
    trackingNumber: String,
    trackingUrl: String,
    fee: Number,
    status: {
      type: String,
      enum: ['pending', 'created', 'accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled', 'fallback'],
      default: 'pending'
    },
    rider: {
      name: String,
      phone: String,
      vehicle: String
    },
    package: { // Added package details for shipping
      weight: Number,
      length: Number,
      width: Number,
      height: Number,
      item_count: Number
    },
    history: [{
      event: String,
      timestamp: Date,
      status: String,
      data: Object
    }]
  },
  // Additional fields for better order tracking
  paid_at: {
    type: Date
  },
  cancellation_reason: {
    type: String
  }
}, { timestamps: true });

// Indexes for better query performance
authOrderSchema.index({ sellerId: 1, createdAt: -1 });
authOrderSchema.index({ orderId: 1 });
authOrderSchema.index({ payment_status: 1 });
authOrderSchema.index({ delivery_status: 1 });
authOrderSchema.index({ 'delivery.provider': 1 });

module.exports = model('authorOrders', authOrderSchema);