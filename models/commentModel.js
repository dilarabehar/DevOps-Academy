const mongoose = require('mongoose');

const commentSchema = mongoose.Schema(
    {
        productID:{
            type: String,
            required: [true, "Please enter productID!"]
        },
        userID: {
            type: String,
            default: 0 
        },
        content: {
            type: String
        },
        rating: {
            type: Number,
            default: 0
        }

    },
    {
        timestamps: true
    }
)
const Comment = mongoose.model('Comment', commentSchema);

module.exports = Comment;
