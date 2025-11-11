// routes/healthCheck.js
const router = require('express').Router()

// Simple health check endpoint
router.get('/health-check', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Detailed health check with database connection
router.get('/health-check/detailed', async (req, res) => {
  try {
    // If you're using MongoDB with Mongoose
    const mongoose = require('mongoose');
    const dbStatus = mongoose.connection.readyState;
    
    const statusMap = {
      0: 'disconnected',
      1: 'connected', 
      2: 'connecting',
      3: 'disconnecting'
    };

    res.status(200).json({
      status: 'success',
      message: 'System health check completed',
      timestamp: new Date().toISOString(),
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development'
      },
      database: {
        status: statusMap[dbStatus] || 'unknown',
        readyState: dbStatus
      },
      services: {
        api: 'operational',
        database: dbStatus === 1 ? 'operational' : 'degraded'
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Health check failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router