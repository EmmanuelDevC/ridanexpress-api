const { Schema, model } = require('mongoose')

const specificationGroupSchema = new Schema({
  title: {
    type: String,
    required: true
  },
  fields: [{
    name: {
      type: String,
      required: true
    }
  }]
}, { _id: false });

const categorySchema = new Schema({
  name: {
    type: String,
    required: true
  },
  image: {
    type: String,
    required: true
  },
  subcategories: {
    type: [String],
    required: true,
    validate: [arrayLimit, '{PATH} exceeds the limit of 10'],
    default: []
  },
  slug: {
    type: String,
    required: true
  },
  // ADDED SPECIFICATION GROUPS
  specificationGroups: {
    type: [specificationGroupSchema],
    default: []
  }
}, { timestamps: true });

function arrayLimit(val) {
  return val.length <= 10;
}

module.exports = model('categorys', categorySchema)