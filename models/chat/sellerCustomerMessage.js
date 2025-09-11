const { Schema, model } = require('mongoose');

const sellerCustomerSchema = new Schema({
  senderName: { type: String, required: true },
  senderId: { type: String, required: true },
  receverId: { type: String, required: true },
  message: { type: String, default: '' },
  type: {
    type: String,
    enum: ['text', 'product', 'invoice', 'image', 'video', 'status'],
    default: 'text'
  },
  content: { type: Schema.Types.Mixed, default: null },
  status: { type: String, default: 'unseen' },
  isAutoReply: { type: Boolean, default: false }, // Add this field
  createdAt: { type: Date, default: Date.now }
});

module.exports = model('seller_customer_messages', sellerCustomerSchema);