const jwt = require('jsonwebtoken');
const User = require('../models/customerModel');

module.exports.authMiddleware = async (req, res, next) => {
    const { authorization } = req.headers;

    if (!authorization?.startsWith('Bearer ')) {
        return res.status(401).json({ 
            message: 'Unauthorized - No token provided',
            forceLogout: true
        });
    }

    const token = authorization.split(' ')[1];
    
    try {
        // 1. Verify JWT structure first
        const decoded = jwt.verify(token, process.env.SECRET);
        
        // 2. Check user exists and validate session
        const user = await User.findById(decoded.id)
            .select('+sessionValid +active');
        
        if (!user || !user.sessionValid || !user.active) {
            return res.status(401).json({
                message: 'Session invalidated - Please login again',
                forceLogout: true
            });
        }

        // 3. Verify token version matches user's current version
        if (decoded.tokenVersion !== user.tokenVersion) {
            return res.status(401).json({
                message: 'Session expired - Please relogin',
                forceLogout: true
            });
        }

        // 4. Attach fresh user data
        req.user = {
            id: user._id,
            role: user.role,
            name: user.name,
            email: user.email,
            sessionValid: user.sessionValid
        };
        
        next();
    } catch (error) {
        return res.status(401).json({
            message: 'Invalid session - ' + error.message,
            forceLogout: true
        });
    }
};