const jwt = require('jsonwebtoken')

module.exports.createToken = (data) => { // Remove async
    try {
        const token = jwt.sign(data, process.env.SECRET, { expiresIn: '7d' }) // Remove await
        return token;
    } catch (error) {
        console.error('Token creation error:', error);
        throw new Error('Failed to create token');
    }
}