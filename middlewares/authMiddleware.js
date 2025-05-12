const jwt = require('jsonwebtoken');

module.exports.authMiddleware = async (req, res, next) => {
    const { authorization } = req.headers;
    
    // Initialize default values
    req.role = 'guest';
    req.id = null;

    if (authorization && authorization.startsWith('Bearer ')) {
        const token = authorization.split(' ')[1];
        
        try {
            const userInfo = await jwt.verify(token, process.env.SECRET);
            req.role = userInfo.role;
            req.id = userInfo.id;
        } catch (error) {
            // Handle different error types
            if (error.name === 'TokenExpiredError') {
                return res.status(401).json({ 
                    message: 'Session expired',
                    shouldRefresh: true
                });
            }
            
            if (error.name === 'JsonWebTokenError') {
                return res.status(401).json({ 
                    message: 'Invalid token',
                    shouldLogout: true
                });
            }
        }
    }
    
    // Always continue to next middleware
    next();
};

// Add optional authentication middleware for public routes
module.exports.optionalAuthMiddleware = async (req, res, next) => {
    const { authorization } = req.headers;
    
    req.role = 'guest';
    req.id = null;

    if (authorization && authorization.startsWith('Bearer ')) {
        const token = authorization.split(' ')[1];
        
        try {
            const userInfo = await jwt.verify(token, process.env.SECRET);
            req.role = userInfo.role;
            req.id = userInfo.id;
        } catch (error) {
            // Silently fail for optional auth
            console.log('Optional auth failed:', error.message);
        }
    }
    
    next();
};