const express = require('express')
const { dbConnect } = require('./utiles/db')
const path = require('path')
const app = express()
const cors = require('cors')
const http = require('http')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
require('dotenv').config()

const socket = require('socket.io')
const mode = process.env.mode
const server = http.createServer(app)

app.use(cors({
    origin: ['http://localhost:3000', 'http://localhost:3001', 'https://ridan-express-client.vercel.app'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
}));

const io = socket(server, {
    cors: {
        origin: ['http://localhost:3000', 'http://localhost:3001', 'https://ridan-express-client.vercel.app'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
    }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'client/build')));
app.use(bodyParser.json());
app.use(cookieParser());

// Store active users
let allCustomer = []
let allSeller = []
let admin = {}

// Helper functions
const addUser = (customerId, socketId, userInfo) => {
    const checkUser = allCustomer.some(u => u.customerId === customerId)
    if (!checkUser) {
        allCustomer.push({
            customerId,
            socketId,
            userInfo
        })
    }
}

const addSeller = (sellerId, socketId, userInfo) => {
    const checkSeller = allSeller.some(u => u.sellerId === sellerId)
    if (!checkSeller) {
        allSeller.push({
            sellerId,
            socketId,
            userInfo
        })
    }
}

const findCustomer = (customerId) => {
    return allCustomer.find(c => c.customerId === customerId)
}

const findSeller = (sellerId) => {
    return allSeller.find(c => c.sellerId === sellerId)
}

const removeUser = (socketId) => {
    allCustomer = allCustomer.filter(c => c.socketId !== socketId)
    allSeller = allSeller.filter(c => c.socketId !== socketId)
}

const removeAdmin = (socketId) => {
    if (admin.socketId === socketId) {
        admin = {}
    }
}

// Socket.io connection handler
io.on('connection', (socket) => {
    console.log('New socket connection:', socket.id)

    // User connection handlers
    socket.on('add_user', (customerId, userInfo) => {
        addUser(customerId, socket.id, userInfo)
        io.emit('activeSeller', allSeller)
        io.emit('activeCustomer', allCustomer)
    })

    socket.on('add_seller', (sellerId, userInfo) => {
        addSeller(sellerId, socket.id, userInfo)
        io.emit('activeSeller', allSeller)
        io.emit('activeCustomer', allCustomer)
        io.emit('activeAdmin', { status: true })
    })

    socket.on('add_admin', (adminInfo) => {
        delete adminInfo.email
        admin = adminInfo
        admin.socketId = socket.id
        io.emit('activeSeller', allSeller)
        io.emit('activeAdmin', { status: true })
    })

    // Message handlers
    socket.on('send_seller_message', (msg) => {
        const customer = findCustomer(msg.receverId)
        if (customer !== undefined) {
            socket.to(customer.socketId).emit('seller_message', msg)
        }
    })

    socket.on('send_customer_message', (msg) => {
        const seller = findSeller(msg.receverId)
        if (seller !== undefined) {
            socket.to(seller.socketId).emit('customer_message', {
                ...msg,
                seen: false // Mark as unread when first received
            })
        }
    })

    // New message seen handler
    socket.on('mark_message_seen', (messageId, senderId) => {
        const seller = findSeller(senderId)
        if (seller) {
            // Notify the customer that their message was seen
            socket.to(seller.socketId).emit('message_seen', messageId)
            
            // Optionally broadcast to all connected devices of the seller
            allSeller.filter(s => s.sellerId === senderId).forEach(s => {
                io.to(s.socketId).emit('message_seen', messageId)
            })
        }
    })

    // Admin message handlers
    socket.on('send_message_admin_to_seller', msg => {
        const seller = findSeller(msg.receverId)
        if (seller !== undefined) {
            socket.to(seller.socketId).emit('receved_admin_message', msg)
        }
    })

    socket.on('send_message_seller_to_admin', msg => {
        if (admin.socketId) {
            socket.to(admin.socketId).emit('receved_seller_message', msg)
        }
    })

    // Disconnection handler
    socket.on('disconnect', () => {
        console.log('User disconnected:', socket.id)
        removeUser(socket.id)
        removeAdmin(socket.id)
        io.emit('activeAdmin', { status: false })
        io.emit('activeSeller', allSeller)
        io.emit('activeCustomer', allCustomer)
    })
})

// Routes
app.use(bodyParser.json())
app.use(cookieParser())

if (process.env.NODE_ENV === 'development') {
    console.log('Loading development test routes');
    app.use('/api/test', require('./routes/testRoutes'));
}

app.use('/api', require('./routes/chatRoutes'))
app.use('/api', require('./routes/paymentRoutes'))
app.use('/api', require('./routes/bannerRoutes'))
app.use('/api', require('./routes/dashboard/dashboardIndexRoutes'))
app.use('/api/home', require('./routes/home/homeRoutes'))
app.use('/api', require('./routes/order/orderRoutes'))
app.use('/api', require('./routes/home/cardRoutes'))
app.use('/api', require('./routes/authRoutes'))
app.use('/api', require('./routes/home/customerAuthRoutes'))
app.use('/api', require('./routes/dashboard/sellerRoutes'))
app.use('/api', require('./routes/dashboard/categoryRoutes'))
app.use('/api', require('./routes/dashboard/productRoutes'))

// app.get('/', (req, res) => res.send('I see what you are doing no try am ⚠️'))

// Start server
const port = process.env.PORT
dbConnect()
server.listen(port, () => console.log(`Server is running on port ${port}!`))