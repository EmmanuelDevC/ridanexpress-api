const jwt = require('jsonwebtoken');

module.exports.authMiddleware = async (req, res, next) => {
    const tokenFromHeader = req.headers.authorization?.split(' ')[1];
    const tokenFromCookie = req.cookies?.customerToken;

    const token = tokenFromHeader || tokenFromCookie;

    if (token) {
        try {
            const userInfo = await jwt.verify(token, process.env.SECRET);
            req.role = userInfo.role;
            req.id = userInfo.id;

            // Add this check for admin routes
            if (req.baseUrl.includes('/admin') && req.role !== 'admin') {
                return res.status(403).json({ message: 'Forbidden: Admin access required' });
            }

            return next();
        } catch (error) {
            return res.status(401).json({ message: 'Unauthorized: Invalid token' });
        }
    }

    return res.status(401).json({ message: 'Unauthorized: No token provided' });
};

module.exports.sellerAuth = async (req, res, next) => {
    const tokenFromHeader = req.headers.authorization?.split(' ')[1];
    const tokenFromCookie = req.cookies?.customerToken;

    const token = tokenFromHeader || tokenFromCookie;

    if (token) {
        try {
            const userInfo = await jwt.verify(token, process.env.SECRET);
            
            // Check role
            if (userInfo.role !== 'seller') {
                return res.status(403).json({ message: 'Forbidden: Seller access only' });
            }

            // ✅ Set required fields
            req.role = userInfo.role;
            req.id = userInfo.id;
            req.sellerId = userInfo.id; // ← Add this line to match existing code usage

            return next();
        } catch (error) {
            return res.status(401).json({ message: 'Unauthorized: Invalid token' });
        }
    }

    return res.status(401).json({ message: 'Unauthorized: No token provided' });
};


// adminAuthMiddleware
module.exports.adminAuthMiddleware = async (req, res, next) => {
    const tokenFromHeader = req.headers.authorization?.split(' ')[1];
    const tokenFromCookie = req.cookies?.customerToken;

    const token = tokenFromHeader || tokenFromCookie;

    if (token) {
        try {
            const userInfo = await jwt.verify(token, process.env.SECRET);

            // Add strict admin role check
            if (userInfo.role !== 'admin') {
                return res.status(403).json({ message: 'Forbidden: Admin access required' });
            }

            req.role = userInfo.role;
            req.id = userInfo.id;
            return next();
        } catch (error) {
            return res.status(401).json({ message: 'Unauthorized: Invalid token' });
        }
    }

    return res.status(401).json({ message: 'Unauthorized: No token provided' });
};
// Optional auth with version checking
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
