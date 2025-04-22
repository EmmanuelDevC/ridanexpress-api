const { Schema, model } = require('mongoose')

const authorSchema = new Schema({
    orderId : {
        type : Schema.ObjectId,
        required : true
    },
    sellerId : {
        type : Schema.ObjectId,
        required : true
    },
    products : {
        type : Array,
        required : true
    },
    price : {
        type : Number,
        required : true,
    },
    payment_status : {
        type : String,
        required : true
    },
    // shippingInfo : {
    //     type : String,
    //     required : true
    // },
    delivery_status : {
        type : String,
        required : true
    },
    createdAt: {
        type: Date,
        default: Date.now
      }
},{timestamps : true})

module.exports = model('authorOrders',authorSchema)