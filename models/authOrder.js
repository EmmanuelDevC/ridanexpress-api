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
    images: { type: [String], required: true }, // Array of strings for image URLs
    price: { type: Number, required: true },
    quantity: { type: Number, required: true }
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
    provider: { type: String, enum: ['self', 'kwik'], default: 'self' },
    kwikOrderId: String,
    trackingUrl: String,
    fee: Number,
    status: {
      type: String,
      enum: ['pending', 'accepted', 'picked_up', 'in_transit', 'delivered', 'cancelled'],
      default: 'pending'
    },
    rider: {
      name: String,
      phone: String
    }
  }

}, { timestamps: true }); // Removed redundant `date` field

module.exports = model('authorOrders', authOrderSchema);