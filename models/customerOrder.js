const { Schema, model } = require('mongoose');

const customerOrderSchema = new Schema({
  customerId: {
    type: Schema.ObjectId,
    required: true
  },
  products: [{ // ✅ Proper sub-schema for products
    productId: { type: Schema.ObjectId, required: true },
    name: { type: String, required: true },
    brand: { type: String, required: true },
    price: { type: Number, required: true },
    discount: { type: Number, required: true },
    images: { type: [String], required: true },
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
  flutterwave_ref: {
    type: String,
    unique: true,
    sparse: true
  },
  delivery_status: {
    type: String,
    required: true
  }
}, { timestamps: true });

module.exports = model('customerOrders', customerOrderSchema);