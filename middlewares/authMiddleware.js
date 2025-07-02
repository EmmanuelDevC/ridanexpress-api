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


// const jwt = require('jsonwebtoken');
// const customerModel = require('../models/customerModel'); // Add customer model

// module.exports.authMiddleware = async (req, res, next) => {
//     const { authorization } = req.headers;

//     // Initialize default values
//     req.role = 'guest';
//     req.id = null;
//     req.tokenVersion = null;

//     if (authorization && authorization.startsWith('Bearer ')) {
//         const token = authorization.split(' ')[1];

//         try {
//             // Verify token and get payload
//             const decoded = await jwt.verify(token, process.env.SECRET);

//             // Fetch fresh user data with token version
//             const user = await customerModel.findById(decoded.id)
//                 .select('tokenVersion role')
//                 .lean();

//             if (!user) {
//                 return res.status(401).json({
//                     message: 'User account not found',
//                     shouldLogout: true
//                 });
//             }

//             // Validate token version
//             if (decoded.tokenVersion !== user.tokenVersion) {
//                 return res.status(401).json({
//                     message: 'Session expired - security revision',
//                     code: 'TOKEN_VERSION_MISMATCH', // Add specific error code
//                     shouldRefresh: true
//                 });
//             }

//             // Set request properties
//             req.role = user.role || 'customer'; // Default to 'customer' if no role
//             req.id = decoded.id;
//             req.tokenVersion = decoded.tokenVersion;

//         } catch (error) {
//             // Enhanced error handling
//             const response = {
//                 message: 'Authentication failed',
//                 error: error.name
//             };

//             switch (error.name) {
//                 case 'TokenExpiredError':
//                     response.message = 'Session expired';
//                     response.shouldRefresh = true;
//                     break;

//                 case 'JsonWebTokenError':
//                     response.message = 'Invalid session token';
//                     response.shouldLogout = true;
//                     break;

//                 default:
//                     response.message = 'Authentication error';
//                     response.shouldLogout = true;
//             }

//             return res.status(401).json(response);
//         }
//     }

//     next();
// };

// // Optional auth with version checking
// module.exports.optionalAuthMiddleware = async (req, res, next) => {
//     const { authorization } = req.headers;

//     req.role = 'guest';
//     req.id = null;

//     if (authorization && authorization.startsWith('Bearer ')) {
//         const token = authorization.split(' ')[1];

//         try {
//             const userInfo = await jwt.verify(token, process.env.SECRET);
//             req.role = userInfo.role;
//             req.id = userInfo.id;
//         } catch (error) {
//             // Silently fail for optional auth
//             console.log('Optional auth failed:', error.message);
//         }
//     }

//     next();
// };