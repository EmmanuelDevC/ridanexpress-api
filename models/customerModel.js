const { Schema, model } = require('mongoose');
const crypto = require('crypto');

const customerSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },
  method: { type: String, required: true }, // e.g., "local", "google", "facebook"
  verified: { type: Boolean, default: false }, // Track verification status
  verificationToken: String, // Token sent via email
  verificationExpires: Date, // Token expiration (e.g., 24 hours)
}, { timestamps: true });

module.exports = model('customers', customerSchema);