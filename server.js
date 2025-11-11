const express = require('express');
const { dbConnect } = require('./utiles/db');
const path = require('path');
const app = express();
const cors = require('cors');
const http = require('http');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const adminRoutes = require('./routes/adminRoutes');
require('dotenv').config();

const socket = require('socket.io');
const server = http.createServer(app);

app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'https://ridanexpress.vercel.app', 'https://ridanexpress-hq.vercel.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
}));

const io = socket(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://localhost:3001', 'https://ridanexpress.vercel.app', 'https://ridanexpress-hq.vercel.app'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH']
  },
  transports: ['websocket', 'polling']
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'client/build')));
app.use(bodyParser.json());
app.use(cookieParser());
app.use('/documents', express.static(path.join(__dirname, 'public/documents')));
app.set('io', io);

// Store active users
let activeUsers = new Map();

// Add user to active users
const addUser = (userId, socketId, userInfo, role) => {
  activeUsers.set(socketId, { userId, role, userInfo });
};

// Find user by ID and role
const findUser = (userId, role) => {
  for (let [socketId, user] of activeUsers.entries()) {
    if (user.userId === userId && user.role === role) {
      return { socketId, ...user };
    }
  }
  return null;
};

// Remove user
const removeUser = (socketId) => {
  activeUsers.delete(socketId);
};

// Get all active users by role
const getActiveUsersByRole = (role) => {
  const users = [];
  for (let user of activeUsers.values()) {
    if (user.role === role) {
      users.push(user);
    }
  }
  return users;
};

// Helper function to create consistent chat room IDs
const getChatRoomId = (id1, id2) => {
  // Sort IDs to ensure consistent room naming regardless of sender/receiver order
  const sortedIds = [id1, id2].sort();
  return `chat_${sortedIds[0]}_${sortedIds[1]}`;
};

// Socket.io connection handler
io.on('connection', (socket) => {
  console.log('New socket connection:', socket.id);

  // Add user
  socket.on('add_user', (userId, userInfo) => {
    addUser(userId, socket.id, userInfo, 'customer');
    io.emit('active_sellers', getActiveUsersByRole('seller'));
    io.emit('active_customers', getActiveUsersByRole('customer'));
  });

  // Add seller
  socket.on('add_seller', (sellerId, userInfo) => {
    addUser(sellerId, socket.id, userInfo, 'seller');
    io.emit('active_sellers', getActiveUsersByRole('seller'));
    io.emit('active_customers', getActiveUsersByRole('customer'));
  });

  // Join chat room
  socket.on('join_chat', (chatId) => {
    socket.join(chatId);
    console.log(`User ${socket.id} joined chat ${chatId}`);
  });

  // Send seller message
  socket.on('send_seller_message', (msg) => {
    const chatId = getChatRoomId(msg.senderId, msg.receverId);

    // Ensure sender is in the room
    socket.join(chatId);

    // Emit to both participants in the room
    io.to(chatId).emit('receive_message', {
      ...msg,
      timestamp: new Date().toISOString()
    });
  });

  // Send customer message
  socket.on('send_customer_message', (msg) => {
    const chatId = getChatRoomId(msg.senderId, msg.receverId);

    // Ensure sender is in the room
    socket.join(chatId);

    // Emit to both participants in the room
    io.to(chatId).emit('receive_message', {
      ...msg,
      timestamp: new Date().toISOString()
    });
  });

  // Typing indicators
  socket.on('typing_start', (data) => {
    const chatId = getChatRoomId(data.senderId, data.receverId);
    socket.to(chatId).emit('typing_indicator', {
      senderId: data.senderId,
      isTyping: true
    });
  });

  socket.on('typing_stop', (data) => {
    const chatId = getChatRoomId(data.senderId, data.receverId);
    socket.to(chatId).emit('typing_indicator', {
      senderId: data.senderId,
      isTyping: false
    });
  });

  // Mark message as seen
  socket.on('mark_message_seen', (data) => {
    const chatId = getChatRoomId(data.senderId, data.receverId);
    socket.to(chatId).emit('message_seen', {
      messageId: data.messageId,
      seenBy: data.seenBy
    });
  });

  // Handle reconnection
  socket.on('reconnect', (attemptNumber) => {
    console.log(`User ${socket.id} reconnected after ${attemptNumber} attempts`);
  });

  // Handle connection errors
  socket.on('connect_error', (error) => {
    console.error(`Connection error for ${socket.id}:`, error);
  });

  // Disconnect handler
  socket.on('disconnect', (reason) => {
    console.log('User disconnected:', socket.id, 'Reason:', reason);
    removeUser(socket.id);
    io.emit('active_sellers', getActiveUsersByRole('seller'));
    io.emit('active_customers', getActiveUsersByRole('customer'));
  });
});

// ==================== HEALTH CHECK ENDPOINTS ====================

// Simple health check
app.get('/api/health-check', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'RidanExpress Server is running',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// Detailed health check with database status
app.get('/api/health-check/detailed', async (req, res) => {
  try {
    // Import mongoose to check database connection
    const mongoose = require('mongoose');
    const dbStatus = mongoose.connection.readyState;
    
    const statusMap = {
      0: 'disconnected',
      1: 'connected', 
      2: 'connecting',
      3: 'disconnecting'
    };

    // Get active socket connections
    const activeConnections = {
      total: activeUsers.size,
      customers: getActiveUsersByRole('customer').length,
      sellers: getActiveUsersByRole('seller').length
    };

    res.status(200).json({
      status: 'success',
      message: 'RidanExpress System Health Check',
      timestamp: new Date().toISOString(),
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        nodeVersion: process.version,
        environment: process.env.NODE_ENV || 'development',
        platform: process.platform
      },
      database: {
        status: statusMap[dbStatus] || 'unknown',
        readyState: dbStatus,
        connection: dbStatus === 1 ? 'healthy' : 'unhealthy'
      },
      websocket: {
        activeConnections: activeConnections,
        totalSockets: io.engine.clientsCount
      },
      services: {
        api: 'operational',
        database: dbStatus === 1 ? 'operational' : 'degraded',
        websocket: 'operational'
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

// Quick ping endpoint (lightweight)
app.head('/api/health-check', (req, res) => {
  res.status(200).end();
});

// ==================== ROUTES ====================

app.use(bodyParser.json());
app.use(cookieParser());

if (process.env.NODE_ENV === 'development') {
  console.log('Loading development test routes');
  app.use('/api/test', require('./routes/testRoutes'));
}

const shippingRoutes = require('./routes/shippingRoutes');
app.use('/api', shippingRoutes);
app.use('/api/webhooks/kwik', require('./routes/webhookRoutes'));

app.use('/api', require('./routes/order/orderRoutes'));
app.use('/api', require('./routes/chatRoutes'));
app.use('/api', require('./routes/paymentRoutes'));
app.use('/api', require('./routes/bannerRoutes'));
app.use('/api', require('./routes/dashboard/dashboardIndexRoutes'));
app.use('/api/home', require('./routes/home/homeRoutes'));
app.use('/api', require('./routes/home/cardRoutes'));
app.use('/api', require('./routes/authRoutes'));
app.use('/api', require('./routes/home/customerAuthRoutes'));
app.use('/api', require('./routes/dashboard/sellerRoutes'));
app.use('/api', require('./routes/dashboard/categoryRoutes'));
app.use('/api', require('./routes/dashboard/productRoutes'));
app.use('/api/admin', adminRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'RidanExpress E-commerce API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    healthCheck: `${req.protocol}://${req.get('host')}/api/health-check`
  });
});

// 404 handler for API routes
app.use('/api/*', (req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'API endpoint not found',
    timestamp: new Date().toISOString(),
    path: req.originalUrl
  });
});

// Start server
const port = process.env.PORT || 5000;
dbConnect();
server.listen(port, () => {
  console.log(`🚀 Server is running on port ${port}!`);
  console.log(`📍 Health check: http://localhost:${port}/api/health-check`);
  console.log(`📍 Detailed health: http://localhost:${port}/api/health-check/detailed`);
});