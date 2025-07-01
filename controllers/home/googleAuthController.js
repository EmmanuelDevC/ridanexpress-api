const customerModel = require('../../models/customerModel');
const { responseReturn } = require('../../utiles/response');
const { createToken } = require('../../utiles/tokenCreate');
const sellerCustomerModel = require('../../models/chat/sellerCustomerModel');
const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

class googleAuthController {
    async verifyGoogleToken(token) {
        try {
            const ticket = await client.verifyIdToken({
                idToken: token,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            return ticket.getPayload();
        } catch (error) {
            console.error('Google Token Verification Error:', error);
            throw new Error('Invalid Google token');
        }
    }

    async googleLoginOrRegister(req, res) {
        const { token } = req.body;

        try {
            // Verify Google token
            const googleUser = await this.verifyGoogleToken(token);

            // Check if user exists
            let customer = await customerModel.findOne({
                $or: [
                    { googleId: googleUser.sub },
                    { email: googleUser.email }
                ]
            });

            if (customer) {
                // If existing user but not Google-authenticated
                if (!customer.googleId) {
                    // Merge accounts
                    customer.googleId = googleUser.sub;
                    customer.method = 'google';
                    await customer.save();
                }
            } else {
                // Create new user
                const password = crypto.randomBytes(16).toString('hex');
                const hashedPassword = await bcrypt.hash(password, 10);

                customer = await customerModel.create({
                    name: googleUser.name,
                    email: googleUser.email,
                    password: hashedPassword, // Still store a password for backup
                    googleId: googleUser.sub,
                    method: 'google',
                    verified: true, // Google emails are already verified
                    // No need for verification token
                });

                // Create chat profile
                await sellerCustomerModel.create({
                    myId: customer._id
                });
            }

            // Generate JWT token
            const jwtToken = await createToken({
                id: customer._id.toString(),
                tokenVersion: customer.tokenVersion,
                name: customer.name,
                email: customer.email,
                method: customer.method
            });

            // Set cookie
            res.cookie('customerToken', jwtToken, {
                expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict'
            });

            responseReturn(res, 200, {
                success: true,
                message: 'Google authentication successful',
                user: {
                    id: customer._id,
                    name: customer.name,
                    email: customer.email,
                    method: customer.method
                },
                token: jwtToken
            });

        } catch (error) {
            console.error('Google Auth Error:', error);
            responseReturn(res, 500, {
                error: 'Google authentication failed',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

module.exports = new googleAuthController();