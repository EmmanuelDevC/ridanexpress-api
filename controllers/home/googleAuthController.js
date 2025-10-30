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

        // Validate token exists
        if (!token) {
            return responseReturn(res, 400, {
                error: 'Google token is required'
            });
        }

        try {
            // Verify Google token
            const googleUser = await this.verifyGoogleToken(token);

            let customer;
            let isNewUser = false;
            
            // Robust retry logic for handling race conditions
            const maxRetries = 3;
            let retryCount = 0;
            let operationSuccess = false;
            
            while (retryCount < maxRetries && !operationSuccess) {
                try {
                    console.log(`Attempt ${retryCount + 1} to find or create user for email: ${googleUser.email}`);
                    
                    // Try to find existing customer by googleId OR email
                    customer = await customerModel.findOne({
                        $or: [
                            { googleId: googleUser.sub },
                            { email: googleUser.email.toLowerCase() } // Ensure case-insensitive email match
                        ]
                    });

                    if (customer) {
                        console.log('Found existing customer:', customer.email);
                        
                        // Update existing user if they don't have googleId (account merging)
                        if (!customer.googleId) {
                            console.log('Merging existing account with Google authentication');
                            customer.googleId = googleUser.sub;
                            customer.method = 'google';
                            customer.verified = true; // Mark as verified since they're using Google
                            await customer.save();
                        } else if (customer.googleId !== googleUser.sub) {
                            // This shouldn't happen due to our query, but just in case
                            throw new Error('Google ID mismatch for existing user');
                        }
                        
                        operationSuccess = true;
                    } else {
                        // Create new user
                        console.log('Creating new customer for:', googleUser.email);
                        const password = crypto.randomBytes(16).toString('hex');
                        const hashedPassword = await bcrypt.hash(password, 10);

                        customer = new customerModel({
                            name: googleUser.name,
                            email: googleUser.email.toLowerCase(),
                            googleId: googleUser.sub,
                            method: 'google',
                            verified: true,
                            password: hashedPassword,
                            tokenVersion: 0 // Initialize token version if your model uses it
                        });

                        await customer.save();
                        isNewUser = true;
                        operationSuccess = true;
                        console.log('Successfully created new customer');
                    }
                    
                } catch (error) {
                    // Handle duplicate key error (race condition)
                    if (error.code === 11000) {
                        retryCount++;
                        console.log(`Duplicate key error detected, retry ${retryCount}/${maxRetries}`);
                        
                        if (retryCount < maxRetries) {
                            // Exponential backoff: wait longer between retries
                            const waitTime = 100 * Math.pow(2, retryCount - 1);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            continue; // Retry the operation
                        } else {
                            // Max retries exceeded, try to find the user one more time
                            console.log('Max retries exceeded, attempting to find user...');
                            customer = await customerModel.findOne({
                                $or: [
                                    { googleId: googleUser.sub },
                                    { email: googleUser.email.toLowerCase() }
                                ]
                            });
                            
                            if (customer) {
                                console.log('Found user after retries:', customer.email);
                                operationSuccess = true;
                                break;
                            } else {
                                throw new Error('Failed to create or find user after maximum retries');
                            }
                        }
                    } else {
                        // Re-throw other errors
                        throw error;
                    }
                }
            }

            if (!operationSuccess || !customer) {
                throw new Error('Failed to process Google authentication');
            }

            // Generate JWT token with comprehensive user data
            const tokenPayload = {
                id: customer._id.toString(),
                name: customer.name,
                email: customer.email,
                method: customer.method
            };

            // Include tokenVersion if your system uses it for token invalidation
            if (customer.tokenVersion !== undefined) {
                tokenPayload.tokenVersion = customer.tokenVersion;
            }

            const jwtToken = await createToken(tokenPayload);

            // Set secure HTTP cookie
            res.cookie('customerToken', jwtToken, {
                expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                path: '/'
            });

            // Prepare response data
            const userResponse = {
                id: customer._id,
                name: customer.name,
                email: customer.email,
                method: customer.method,
                verified: customer.verified
            };

            responseReturn(res, 200, {
                success: true,
                message: isNewUser ? 'Google registration successful' : 'Google login successful',
                user: userResponse,
                token: jwtToken,
                isNewUser: isNewUser
            });

        } catch (error) {
            console.error('Google Auth Error:', error);
            
            // Determine appropriate status code
            let statusCode = 500;
            let errorMessage = 'Google authentication failed';
            
            if (error.message.includes('Invalid Google token')) {
                statusCode = 401;
                errorMessage = 'Invalid Google token';
            } else if (error.message.includes('Google ID mismatch')) {
                statusCode = 409;
                errorMessage = 'Account conflict - please contact support';
            }

            responseReturn(res, statusCode, {
                success: false,
                error: errorMessage,
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    // Optional: Method to handle Google account linking for existing users
    async linkGoogleAccount(req, res) {
        const { token } = req.body;
        const userId = req.user.id; // Assuming you have user auth middleware

        if (!token) {
            return responseReturn(res, 400, {
                error: 'Google token is required'
            });
        }

        try {
            const googleUser = await this.verifyGoogleToken(token);
            
            // Check if Google account is already linked to another user
            const existingUser = await customerModel.findOne({
                googleId: googleUser.sub,
                _id: { $ne: userId }
            });

            if (existingUser) {
                return responseReturn(res, 409, {
                    error: 'This Google account is already linked to another user'
                });
            }

            // Update user with Google credentials
            const customer = await customerModel.findByIdAndUpdate(
                userId,
                {
                    googleId: googleUser.sub,
                    method: 'google',
                    verified: true
                },
                { new: true }
            );

            if (!customer) {
                return responseReturn(res, 404, {
                    error: 'User not found'
                });
            }

            responseReturn(res, 200, {
                success: true,
                message: 'Google account linked successfully',
                user: {
                    id: customer._id,
                    name: customer.name,
                    email: customer.email,
                    method: customer.method
                }
            });

        } catch (error) {
            console.error('Google Account Linking Error:', error);
            responseReturn(res, 500, {
                error: 'Failed to link Google account',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }
}

module.exports = new googleAuthController();