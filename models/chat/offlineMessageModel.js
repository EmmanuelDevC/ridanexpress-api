const { Schema, model } = require('mongoose');

const offlineMessageSchema = new Schema({
  recipientId: {
    type: String,
    required: true
  },
  message: {
    type: Object,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = model('offline_messages', offlineMessageSchema);