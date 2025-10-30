const { Schema, model } = require('mongoose');

const customerOrderSchema = new Schema({
  customerId: {
    type: Schema.ObjectId,
    required: true
  },
  products: [{ 
    productId: { type: Schema.ObjectId, required: true },
    name: { type: String, required: true },
    brand: { type: String, required: true },
    price: { type: Number, required: true },
    discount: { type: Number, required: true },
    images: { type: [String], required: true },
    quantity: { type: Number, required: true },
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
  flutterwave_ref: {
    type: String,
    unique: true,
    sparse: true
  },
  delivery_status: {
    type: String,
    required: true
  },
  delivery: {
    provider: String,
    trackingNumber: String,
    status: String,
    history: [
      {
        event: String,
        timestamp: Date,
        data: Object
      }
    ]
  },
  // Additional fields for better order management
  paid_at: {
    type: Date
  },
  cancellation_reason: {
    type: String
  }
}, { timestamps: true });

// Index for better query performance
customerOrderSchema.index({ customerId: 1, createdAt: -1 });
customerOrderSchema.index({ payment_status: 1 });
customerOrderSchema.index({ delivery_status: 1 });

module.exports = model('customerOrders', customerOrderSchema);