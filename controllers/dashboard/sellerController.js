const mongoose = require('mongoose');
const sellerModel = require('../../models/sellerModel');
const Product = require('../../models/productModel');
const { responseReturn } = require('../../utiles/response');
const AutoReplyConfig = require('../../models/autoReplyConfigModel')

class sellerController {
    // Validate MongoDB ID format
    validateObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

    // Function to handle auto-reply logic
    handleAutoReply = async (senderId, receiverId, message, senderName) => {
        try {
            // Get the seller's auto-reply config
            const config = await AutoReplyConfig.findOne({ sellerId: receiverId });

            if (!config || !config.isActive) {
                return null; // Auto-reply not enabled
            }

            let replyMessage = '';

            // Check if this is the first message in the conversation
            const messageCount = await sellerCustomerMessage.countDocuments({
                $or: [
                    { senderId, receverId: receiverId },
                    { senderId: receiverId, receverId: senderId }
                ]
            });

            // If it's the first message, send welcome message (regardless of online status)
            if (messageCount === 0) {
                replyMessage = config.welcomeMessage;
            }
            // Check if the seller is offline (not in activeUsers)
            else if (!isSellerOnline(receiverId)) {
                replyMessage = config.offlineMessage;
            }
            // Check if it's an order inquiry (only when seller is online)
            else if (isOrderInquiry(message)) {
                replyMessage = config.orderInquiryResponse;

                // Replace [link] with actual tracking link if available
                const order = await getCustomerOrder(senderId);
                if (order && order.trackingLink) {
                    replyMessage = replyMessage.replace('[link]', order.trackingLink);
                } else {
                    replyMessage = replyMessage.replace('[link]', 'your order details');
                }
            }

            if (replyMessage) {
                // Create and save the auto-reply message
                const autoReply = new sellerCustomerMessage({
                    senderName: "Auto-Reply System",
                    senderId: receiverId,
                    receverId: senderId,
                    message: replyMessage,
                    type: 'text',
                    status: 'seen', // Auto-replies are automatically marked as seen
                    isAutoReply: true
                });

                await autoReply.save();
                return autoReply;
            }

            return null;
        } catch (error) {
            console.error('Error in auto-reply:', error);
            return null;
        }
    };

    // Helper function to check if seller is online
    isSellerOnline = (sellerId) => {
        // This should check your activeUsers map in server.js
        // You'll need to pass the io instance or find another way to access activeUsers
        for (let [socketId, user] of activeUsers.entries()) {
            if (user.userId === sellerId && user.role === 'seller') {
                return true;
            }
        }
        return false;
    }

    // In getAutoReplyConfig method:
    getAutoReplyConfig = async (req, res) => {
        try {
            const { sellerId } = req.params;
            const config = await AutoReplyConfig.findOne({ sellerId });

            if (!config) {
                return res.status(200).json({
                    offlineMessage: "Thanks for your message! We're currently offline and will respond as soon as possible.",
                    welcomeMessage: "Hello! Thanks for reaching out. How can I help you today?",
                    orderInquiryResponse: "Your order is being processed and will ship soon.",
                    isActive: false
                });
            }

            res.status(200).json(config); // Directly return the config object
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Error fetching auto-reply config' });
        }
    };

    // In saveAutoReplyConfig method:
    saveAutoReplyConfig = async (req, res) => {
        try {
            const { sellerId, offlineMessage, welcomeMessage, orderInquiryResponse, isActive } = req.body;

            let config = await AutoReplyConfig.findOne({ sellerId });

            if (!config) {
                config = new AutoReplyConfig({
                    sellerId,
                    offlineMessage,
                    welcomeMessage,
                    orderInquiryResponse,
                    isActive
                });
            } else {
                config.offlineMessage = offlineMessage;
                config.welcomeMessage = welcomeMessage;
                config.orderInquiryResponse = orderInquiryResponse;
                config.isActive = isActive;
            }

            await config.save();
            res.status(200).json({ message: 'Auto-reply settings saved successfully' });
        } catch (error) {
            console.error(error);
            res.status(500).json({ message: 'Error saving auto-reply config' });
        }
    };

    // Get seller requests
    get_seller_request = async (req, res) => {
        const { page = 1, searchValue, parPage = 10 } = req.query;
        const skipPage = parseInt(parPage) * (parseInt(page) - 1);

        try {
            let query = { status: 'pending' };
            if (searchValue) {
                query = {
                    ...query,
                    $text: { $search: searchValue }
                };
            }

            const [sellers, totalSeller] = await Promise.all([
                sellerModel.find(query)
                    .skip(skipPage)
                    .limit(parseInt(parPage))
                    .sort({ createdAt: -1 })
                    .lean(),
                sellerModel.countDocuments(query)
            ]);

            responseReturn(res, 200, { totalSeller, sellers });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error fetching seller requests'
            });
        }
    }

    // Get single seller
    get_seller = async (req, res) => {
        const { sellerId } = req.params;

        try {
            if (!this.validateObjectId(sellerId)) {
                return responseReturn(res, 400, { error: 'Invalid seller ID format' });
            }

            const seller = await sellerModel.findById(sellerId).lean();
            if (!seller) {
                return responseReturn(res, 404, { error: 'Seller not found' });
            }

            responseReturn(res, 200, { seller });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error fetching seller'
            });
        }
    }

    // Get seller products
    get_seller_products = async (req, res) => {
        try {
            const { sellerId } = req.params;
            let { page = 1, parPage = 12 } = req.query;

            // Validate inputs
            page = Math.max(1, parseInt(page));
            parPage = Math.max(1, parseInt(parPage));

            if (!this.validateObjectId(sellerId)) {
                return responseReturn(res, 400, { error: 'Invalid seller ID format' });
            }

            const [products, totalProducts] = await Promise.all([
                Product.find({ sellerId })
                    .skip((page - 1) * parPage)
                    .limit(parPage)
                    .sort({ createdAt: -1 })
                    .select('name price images discount rating stock slug category createdAt')
                    .lean(),
                Product.countDocuments({ sellerId })
            ]);

            responseReturn(res, 200, {
                products,
                totalProducts,
                currentPage: page,
                parPage
            });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error fetching seller products'
            });
        }
    }

    // Get seller details
    get_seller_details = async (req, res) => {
        try {
            const { sellerId } = req.params;

            if (!this.validateObjectId(sellerId)) {
                return responseReturn(res, 400, { error: 'Invalid seller ID format' });
            }

            const [seller, totalProducts] = await Promise.all([
                sellerModel.findById(sellerId)
                    .select('name image shopInfo createdAt')
                    .lean()
                    .then(res => res || Promise.reject(new Error('Seller not found'))),
                Product.countDocuments({ sellerId })
            ]);

            responseReturn(res, 200, {
                seller: { ...seller, totalProducts }
            });
        } catch (error) {
            const statusCode = error.message === 'Seller not found' ? 404 : 500;
            responseReturn(res, statusCode, {
                error: statusCode === 404
                    ? error.message
                    : 'Server error fetching seller details'
            });
        }
    }

    // Update seller status
    seller_status_update = async (req, res) => {
        const { sellerId, status } = req.body;

        try {
            if (!this.validateObjectId(sellerId)) {
                return responseReturn(res, 400, { error: 'Invalid seller ID format' });
            }

            const updatedSeller = await sellerModel.findByIdAndUpdate(
                sellerId,
                { status },
                { new: true, runValidators: true }
            );

            if (!updatedSeller) {
                return responseReturn(res, 404, { error: 'Seller not found' });
            }

            responseReturn(res, 200, {
                seller: updatedSeller,
                message: 'Seller status updated successfully'
            });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error updating seller status'
            });
        }
    }

    // Get active sellers
    get_active_sellers = async (req, res) => {
        try {
            const { page = 1, searchValue, parPage = 10 } = req.query;
            const skipPage = parPage * (page - 1);

            let query = { status: 'active' };
            if (searchValue) {
                query.$text = { $search: searchValue };
            }

            const [sellers, totalSeller] = await Promise.all([
                sellerModel.find(query)
                    .skip(skipPage)
                    .limit(parPage)
                    .sort({ createdAt: -1 })
                    .lean(),
                sellerModel.countDocuments(query)
            ]);

            responseReturn(res, 200, { totalSeller, sellers });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error fetching active sellers'
            });
        }
    }

    // Get deactivated sellers
    get_deactive_sellers = async (req, res) => {
        try {
            const { page = 1, searchValue, parPage = 10 } = req.query;
            const skipPage = parPage * (page - 1);

            let query = { status: 'deactive' };
            if (searchValue) {
                query.$text = { $search: searchValue };
            }

            const [sellers, totalSeller] = await Promise.all([
                sellerModel.find(query)
                    .skip(skipPage)
                    .limit(parPage)
                    .sort({ createdAt: -1 })
                    .lean(),
                sellerModel.countDocuments(query)
            ]);

            responseReturn(res, 200, { totalSeller, sellers });
        } catch (error) {
            responseReturn(res, 500, {
                error: process.env.NODE_ENV === 'development'
                    ? error.message
                    : 'Server error fetching deactivated sellers'
            });
        }
    }
}

module.exports = new sellerController();