const sellerModel = require('../../models/sellerModel');
const customerModel = require('../../models/customerModel');
const sellerCustomerModel = require('../../models/chat/sellerCustomerModel');
const sellerCustomerMessage = require('../../models/chat/sellerCustomerMessage');
const adminSellerMessage = require('../../models/chat/adminSellerMessage');
const offlineMessageModel = require('../../models/chat/offlineMessageModel');
const { responseReturn } = require('../../utiles/response');
const { mongo: { ObjectId } } = require('mongoose');

const maskContacts = (text) => {
    // Mask emails and phone numbers
    return text
        .replace(/\b[\w.-]+@[\w.-]+\.\w{2,}\b/g, '***@***.***')
        .replace(/\b\d{10,13}\b/g, '***-***-****');
};


class chatController {
    add_customer_friend = async (req, res) => {
        const { sellerId, userId } = req.body;
        try {
            if (sellerId) {
                const [seller, user] = await Promise.all([
                    sellerModel.findById(sellerId),
                    customerModel.findById(userId)
                ]);

                if (!seller || !user) {
                    return responseReturn(res, 404, { error: 'Seller or user not found' });
                }

                // Use bulkWrite for more efficient updates
                const bulkOps = [];

                // Check and add seller to customer's friend list
                const checkSeller = await sellerCustomerModel.findOne({
                    myId: userId,
                    'myFriends.fdId': sellerId
                });

                if (!checkSeller) {
                    bulkOps.push({
                        updateOne: {
                            filter: { myId: userId },
                            update: {
                                $push: {
                                    myFriends: {
                                        fdId: sellerId,
                                        name: seller.shopInfo?.shopName,
                                        image: seller.image,
                                        rating: seller.rating || 4.5
                                    }
                                }
                            },
                            upsert: true
                        }
                    });
                }

                // Check and add customer to seller's friend list
                const checkCustomer = await sellerCustomerModel.findOne({
                    myId: sellerId,
                    'myFriends.fdId': userId
                });

                if (!checkCustomer) {
                    bulkOps.push({
                        updateOne: {
                            filter: { myId: sellerId },
                            update: {
                                $push: {
                                    myFriends: {
                                        fdId: userId,
                                        name: user.name,
                                        image: user.image || ""
                                    }
                                }
                            },
                            upsert: true
                        }
                    });
                }

                if (bulkOps.length > 0) {
                    await sellerCustomerModel.bulkWrite(bulkOps);
                }

                // Get messages between seller and customer
                const messages = await sellerCustomerMessage.find({
                    $or: [
                        { receverId: sellerId, senderId: userId },
                        { receverId: userId, senderId: sellerId }
                    ]
                }).sort({ createdAt: 1 });

                const MyFriends = await sellerCustomerModel.findOne({ myId: userId });
                const currentFd = MyFriends.myFriends.find(s => s.fdId === sellerId);

                responseReturn(res, 200, {
                    myFriends: MyFriends.myFriends,
                    currentFd,
                    messages
                });
            } else {
                const MyFriends = await sellerCustomerModel.findOne({ myId: userId });
                responseReturn(res, 200, { myFriends: MyFriends.myFriends });
            }
        } catch (error) {
            console.error('Error adding friend:', error);
            responseReturn(res, 500, { error: 'Internal server error' });
        }
    }

    customer_message_add = async (req, res) => {
        let { userId, text, sellerId, name, type, content } = req.body;

        try {
            if (type === 'text' && text) {
                text = maskContacts(text);
            }

            const messageData = {
                senderId: userId,
                senderName: name,
                receverId: sellerId,
                type: type || 'text',
                content: content || text,
                read: false
            };

            const message = await sellerCustomerMessage.create(messageData);

            // 🔥 emit to chat room
            if (req.app.get('io')) {
                const io = req.app.get('io');
                const chatId = `chat_${[userId, sellerId].sort().join('_')}`;
                io.to(chatId).emit('receive_message', message);
            }

            responseReturn(res, 201, { message });
        } catch (error) {
            console.log(error);
            responseReturn(res, 500, { error: 'Message send failed' });
        }
    }


    get_customers = async (req, res) => {
        const { sellerId } = req.params;
        try {
            const data = await sellerCustomerModel.findOne({ myId: sellerId });
            responseReturn(res, 200, { customers: data.myFriends });
        } catch (error) {
            console.log(error);
            responseReturn(res, 500, { error: 'Error getting customers' });
        }
    }

    get_customer_seller_message = async (req, res) => {
        const { customerId } = req.params;
        const { id } = req;

        try {
            const messages = await sellerCustomerMessage.find({
                $or: [
                    { $and: [{ receverId: customerId }, { senderId: id }] },
                    { $and: [{ receverId: id }, { senderId: customerId }] }
                ]
            }).sort({ createdAt: 1 });

            const currentCustomer = await customerModel.findById(customerId);
            responseReturn(res, 200, { messages, currentCustomer });
        } catch (error) {
            console.log(error);
            responseReturn(res, 500, { error: 'Error getting messages' });
        }
    }

    seller_message_add = async (req, res) => {
        let { senderId, text, receverId, name, type, content } = req.body;

        try {
            // Apply contact masking to text messages
            if (type === 'text' && text) {
                text = maskContacts(text);
            }

            const messageData = {
                senderId,
                senderName: name,
                receverId,
                type: type || 'text',
                content: content || text,
                read: false
            };

            const message = await sellerCustomerMessage.create(messageData);

            // Update friend lists to move to top
            const data = await sellerCustomerModel.findOne({ myId: senderId });
            let myFriends = data.myFriends;
            let index = myFriends.findIndex(f => f.fdId === receverId);

            while (index > 0) {
                let temp = myFriends[index];
                myFriends[index] = myFriends[index - 1];
                myFriends[index - 1] = temp;
                index--;
            }

            await sellerCustomerModel.updateOne({ myId: senderId }, { myFriends });

            const data1 = await sellerCustomerModel.findOne({ myId: receverId });
            let myFriends1 = data1.myFriends;
            let index1 = myFriends1.findIndex(f => f.fdId === senderId);

            while (index1 > 0) {
                let temp1 = myFriends1[index1];
                myFriends1[index1] = myFriends1[index1 - 1];
                myFriends1[index1 - 1] = temp1;
                index1--;
            }

            await sellerCustomerModel.updateOne({ myId: receverId }, { myFriends: myFriends1 });

            // Check if recipient is offline and store message
            const recipient = await customerModel.findById(receverId);
            if (!recipient) {
                await offlineMessageModel.create({
                    recipientId: receverId,
                    message: messageData,
                    createdAt: new Date()
                });
            }

            responseReturn(res, 201, { message });
        } catch (error) {
            console.log(error);
            responseReturn(res, 500, { error: 'Message send failed' });
        }
    }

    mark_message_as_read = async (req, res) => {
        const { messageId } = req.params;
        try {
            await sellerCustomerMessage.findByIdAndUpdate(messageId, {
                read: true,
                readAt: new Date()
            });
            responseReturn(res, 200, { message: 'Message marked as read' });
        } catch (error) {
            console.log(error);
            responseReturn(res, 500, { error: 'Failed to mark message as read' });
        }
    }

    get_offline_messages = async (req, res) => {
        const { userId } = req.params;
        try {
            const messages = await offlineMessageModel.find({ recipientId: userId });
            responseReturn(res, 200, { messages });
        } catch (error) {
            console.log(error);
            responseReturn(res, 500, { error: 'Failed to get offline messages' });
        }
    }

    delete_offline_messages = async (req, res) => {
        const { userId } = req.params;
        try {
            await offlineMessageModel.deleteMany({ recipientId: userId });
            responseReturn(res, 200, { message: 'Offline messages deleted' });
        } catch (error) {
            console.log(error);
            responseReturn(res, 500, { error: 'Failed to delete offline messages' });
        }
    }

    get_sellers = async (req, res) => {
        try {
            const sellers = await sellerModel.find({})
            responseReturn(res, 200, { sellers })
        } catch (error) {
            console.log(error)
        }
    }

    seller_admin_message_insert = async (req, res) => {
        const { senderId, receverId, message, senderName } = req.body
        try {
            const messageData = await adminSellerMessage.create({
                senderId,
                receverId,
                senderName,
                message
            })
            responseReturn(res, 200, { message: messageData })
        } catch (error) {
            console.log(error)
        }
    }

    get_admin_messages = async (req, res) => {

        const { receverId } = req.params;
        const id = ""
        try {
            const messages = await adminSellerMessage.find({
                $or: [
                    {
                        $and: [{
                            receverId: { $eq: receverId }
                        }, {
                            senderId: {
                                $eq: id
                            }
                        }]
                    },
                    {
                        $and: [{
                            receverId: { $eq: id }
                        }, {
                            senderId: {
                                $eq: receverId
                            }
                        }]
                    }
                ]
            })
            let currentSeller = {}
            if (receverId) {
                currentSeller = await sellerModel.findById(receverId)
            }
            responseReturn(res, 200, { messages, currentSeller })
        } catch (error) {
            console.log(error)
        }
    }

    get_seller_messages = async (req, res) => {

        const receverId = ""
        const { id } = req
        try {
            const messages = await adminSellerMessage.find({
                $or: [
                    {
                        $and: [{
                            receverId: { $eq: receverId }
                        }, {
                            senderId: {
                                $eq: id
                            }
                        }]
                    },
                    {
                        $and: [{
                            receverId: { $eq: id }
                        }, {
                            senderId: {
                                $eq: receverId
                            }
                        }]
                    }
                ]
            })
            responseReturn(res, 200, { messages })
        } catch (error) {
            console.log(error)
        }
    }
}

module.exports = new chatController()