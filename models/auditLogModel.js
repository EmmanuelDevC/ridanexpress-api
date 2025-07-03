const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
  userId: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true,
    index: true 
  },
  userType: {
    type: String,
    enum: ['admin', 'seller', 'system'],
    required: true
  },
  action: { 
    type: String, 
    required: true,
    index: true 
  },
  entityType: {
    type: String,
    enum: ['seller', 'document', 'payment', 'account', 'order'],
    required: true
  },
  entityId: mongoose.Schema.Types.ObjectId,
  details: { 
    type: mongoose.Schema.Types.Mixed,
    default: {} 
  },
  ipAddress: { 
    type: String, 
    required: true 
  },
  userAgent: String,
  location: {
    country: String,
    region: String,
    city: String
  },
  riskLevel: {
    type: Number,
    min: 0,
    max: 10,
    default: 0
  }
}, { 
  timestamps: true,
  // Disable versioning for immutability
  versionKey: false 
});

// Add TTL index for automatic expiration (7 years)
auditLogSchema.index({ createdAt: 1 }, { 
  expireAfterSeconds: 7 * 365 * 24 * 60 * 60  // 7 years in seconds
});

// Add compound index for common queries
auditLogSchema.index({ userId: 1, action: 1 });
auditLogSchema.index({ entityType: 1, entityId: 1 });

// Prevent updates to audit logs
auditLogSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    const err = new Error('Audit logs are immutable');
    err.name = 'ImmutableDocumentError';
    return next(err);
  }
  next();
});

module.exports = mongoose.model('AuditLog', auditLogSchema);