const mongoose = require('mongoose');

const autoReplyConfigSchema = new mongoose.Schema({
  sellerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Seller',
    required: true,
    unique: true
  },
  offlineMessage: {
    type: String,
    default: "Thanks for your message! We're currently offline and will respond as soon as possible."
  },
  welcomeMessage: {
    type: String,
    default: "Hello! Thanks for reaching out. How can I help you today?"
  },
  orderInquiryResponse: {
    type: String,
    default: "Your order is being processed and will ship soon."
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = mongoose.model('AutoReplyConfig', autoReplyConfigSchema);