const { Schema, model } = require('mongoose');
const crypto = require('crypto');

const customerSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },
  method: { type: String, required: true },
  verified: { type: Boolean, default: false },
  verificationToken: String,
  verificationExpires: Date,
  // New security fields
  active: {
    type: Boolean,
    default: true
  },
  tokenVersion: {
    type: Number,
    default: 0
  },
  lastLogoutAt: Date,
  sessionValid: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

module.exports = model('customers', customerSchema);