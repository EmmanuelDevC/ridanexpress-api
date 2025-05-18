const customerModel = require('../../models/customerModel');
const { responseReturn } = require('../../utiles/response');
const { createToken } = require('../../utiles/tokenCreate');
const sellerCustomerModel = require('../../models/chat/sellerCustomerModel');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Types } = require('mongoose');
const sendVerificationEmail = require('../../utiles/emailSender'); // Add email sender
const sendPasswordChangeEmail = require('../../utiles/passwordChangeEmail'); // Add email sender

class customerAuthController {
    customer_register = async (req, res) => {
        const { name, email, password } = req.body;

        try {
            // Validate input
            if (!name || !email || !password) {
                return responseReturn(res, 400, { error: 'All fields are required' });
            }

            // Check existing user using email normalization
            const normalizedEmail = email.trim().toLowerCase();
            const customer = await customerModel.findOne({ email: normalizedEmail });
            if (customer) {
                return responseReturn(res, 409, { error: 'Email already registered' }); // 409 Conflict
            }

            // Generate verification token
            const verificationToken = crypto.randomBytes(20).toString('hex');
            const verificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

            // Hash password
            const hashedPassword = await bcrypt.hash(password, 10);

            // Create customer
            const newCustomer = await customerModel.create({
                name: name.trim(),
                email: normalizedEmail,
                password: hashedPassword,
                method: 'manually',
                verified: false,
                verificationToken,
                verificationExpires
            });

            // Create chat profile
            await sellerCustomerModel.create({
                myId: newCustomer._id // Use MongoDB's _id field
            });

            // Send verification email
            try {
                await sendVerificationEmail(email, verificationToken);
            } catch (emailError) {
                console.error('Email Error:', emailError);
                await customerModel.deleteOne({ email }); // Rollback user creation
                return res.status(502).json({
                    error: 'Verification email failed to send',
                    details: 'Please try again later'
                });
            }

            res.status(201).json({
                message: 'Registration successful! Check your email',
                email: email
            });

        } catch (error) {
            console.error('Registration Error:', error);
            res.status(500).json({
                error: 'Registration failed',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        };

    }

    customer_update = async (req, res) => {
        const { id } = req.params;
        const { name, email, newPassword, currentPassword } = req.body;

        if (!Types.ObjectId.isValid(id)) {
            return responseReturn(res, 400, { error: 'Invalid user ID' });
        }

        try {
            const customer = await customerModel.findById(id).select('+password');
            if (!customer) {
                return responseReturn(res, 404, { error: 'User not found' });
            }

            // Verify current password
            const isMatch = await bcrypt.compare(currentPassword, customer.password);
            if (!isMatch) {
                return responseReturn(res, 401, { error: 'Current password is incorrect' });
            }

            const updates = {};
            let securityUpdate = false;

            // Name update
            if (name && name !== customer.name) {
                updates.name = name.trim();
            }

            // Email update
            if (email && email !== customer.email) {
                updates.email = email.toLowerCase().trim();
            }

            // Password update
            if (newPassword) {
                // Validate new password complexity
                const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
                if (!passwordRegex.test(newPassword)) {
                    return responseReturn(res, 400, {
                        error: 'Password requirements not met',
                        requirements: [
                            'Minimum 8 characters',
                            'At least one uppercase letter',
                            'At least one number',
                            'At least one special character (@$!%*?&)'
                        ]
                    });
                }

                // Check password history
                const isSamePassword = await bcrypt.compare(newPassword, customer.password);
                if (isSamePassword) {
                    return responseReturn(res, 400, { error: 'New password must be different' });
                }

                // Generate password reset token
                const resetToken = crypto.randomBytes(32).toString('hex'); // 64 characters
                const hashedToken = crypto.createHash('sha256')
                    .update(resetToken)
                    .digest('hex');

                updates.password = await bcrypt.hash(newPassword, 10);
                updates.tokenVersion = customer.tokenVersion + 1;
                updates.resetPasswordToken = hashedToken;
                updates.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 minutes
                securityUpdate = true;

                // Send security email
                await sendPasswordChangeEmail({
                    email: customer.email,
                    name: customer.name,
                    resetLink: `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`
                });
            }

            if (Object.keys(updates).length === 0) {
                return responseReturn(res, 400, { error: 'No changes detected' });
            }

            // Perform atomic update
            const updatedUser = await customerModel.findByIdAndUpdate(
                id,
                updates,
                { new: true, runValidators: true }
            ).select('-password');

            const responsePayload = {
                message: securityUpdate
                    ? 'Password updated. All sessions terminated.'
                    : 'Profile updated successfully',
                user: updatedUser
            };

            if (securityUpdate) {
                responsePayload.requiresReauth = true;
                res.clearCookie('customerToken');
            }

            responseReturn(res, 200, responsePayload);

        } catch (error) {
            console.error('Update Error:', error);
            responseReturn(res, 500, {
                error: error.message || 'Update failed'
            });
        }
    }

    customer_login = async (req, res) => {
        const { email, password } = req.body;
        try {
            const customer = await customerModel.findOne({ email })
                .select('+password')
                .lean();

            if (!customer) {
                return responseReturn(res, 404, { error: 'Email not found' });
            }

            if (!customer.verified) {
                return responseReturn(res, 403, {
                    error: 'Email not verified. Check your inbox or resend verification.'
                });
            }

            const match = await bcrypt.compare(password, customer.password);
            if (!match) {
                return responseReturn(res, 401, { error: "Incorrect password" });
            }

            // Use proper ObjectId conversion
            const token = await createToken({
                id: customer._id.toString(), // Critical fix here
                tokenVersion: customer.tokenVersion,
                name: customer.name,
                email: customer.email,
                method: customer.method
            });

            // Set secure cookie flags
            res.cookie('customerToken', token, {
                expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict'
            });

            // Sanitize response
            const userData = (({ _id, name, email, verified }) => ({
                id: _id.toString(),
                name,
                email,
                verified
            }))(customer);

            responseReturn(res, 200, {
                message: 'Login success',
                user: userData,
                token
            });

        } catch (error) {
            console.error('Login Error:', error);
            responseReturn(res, 500, {
                error: 'Authentication failed',
                ...(process.env.NODE_ENV === 'development' && { details: error.message })
            });
        }
    }


    verify_email = async (req, res) => {
        const { token } = req.query;
        try {
            const customer = await customerModel.findOne({
                verificationToken: token,
                verificationExpires: { $gt: Date.now() }
            });

            if (!customer) {
                return responseReturn(res, 400, { error: 'Invalid or expired token' });
            }

            // Mark as verified and clear token
            customer.verified = true;
            customer.verificationToken = undefined;
            customer.verificationExpires = undefined;
            await customer.save();

            responseReturn(res, 200, { message: 'Email verified! You can now login.' });
        } catch (error) {
            console.log(error.message);
            responseReturn(res, 500, { error: 'Server error' });
        }
    }

    resend_verification = async (req, res) => {
        const { email } = req.body;
        try {
            const customer = await customerModel.findOne({ email });
            if (!customer) {
                return responseReturn(res, 404, { error: 'Email not found' });
            }
            if (customer.verified) {
                return responseReturn(res, 400, { error: 'Email already verified' });
            }

            // Generate new token
            customer.verificationToken = crypto.randomBytes(20).toString('hex');
            customer.verificationExpires = Date.now() + 24 * 60 * 60 * 1000;
            await customer.save();

            // Resend email
            await sendVerificationEmail(email, customer.verificationToken);

            responseReturn(res, 200, { message: 'Verification email resent!' });
        } catch (error) {
            console.log(error.message);
            responseReturn(res, 500, { error: 'Server error' });
        }
    }

    request_password_reset = async (req, res) => {
        const { email } = req.body;

        try {
            const customer = await customerModel.findOne({ email });
            if (!customer) {
                return responseReturn(res, 404, { error: 'Email not found' });
            }

            // Generate reset token
            const resetToken = crypto.randomBytes(32).toString('hex'); // 64 chars
            const hashedToken = crypto.createHash('sha256')
                .update(resetToken)
                .digest('hex');

            // 15 minute expiration
            const resetTokenExpiry = Date.now() + 15 * 60 * 1000;

            // Debugging logs
            console.log('Generated Token:', resetToken);
            console.log('Hashed Token:', hashedToken);
            console.log('Expiry Time:', new Date(resetTokenExpiry));

            await customerModel.findByIdAndUpdate(customer._id, {
                resetPasswordToken: hashedToken,
                resetPasswordExpire: resetTokenExpiry
            }, { new: true, runValidators: true }); // Added options for validation

            // Send email with unhashed token
            await sendPasswordChangeEmail({
                email: customer.email,
                name: customer.name,
                resetLink: `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`
            });

            responseReturn(res, 200, {
                message: 'Password reset email sent',
                debugToken: process.env.NODE_ENV === 'development' ? resetToken : undefined
            });

        } catch (error) {
            console.error('Password Reset Error:', error);
            responseReturn(res, 500, { error: 'Password reset failed' });
        }
    }

    reset_password = async (req, res) => {
        const { token, newPassword } = req.body;
        console.log('Received reset request:', req.body); // Add this line
        console.log('Raw token:', token);
        console.log('New password:', newPassword);

        try {
            // 1. Validate token format
            if (!token || token.length !== 64) {
                return responseReturn(res, 400, {
                    error: 'Invalid token format',
                    code: 'INVALID_TOKEN'
                });
            }

            // 2. Hash the received token
            const hashedToken = crypto.createHash('sha256')
                .update(token)
                .digest('hex');

            // 3. Find user with valid token
            const customer = await customerModel.findOne({
                resetPasswordToken: hashedToken,
                resetPasswordExpire: { $gt: Date.now() }
            }).select('+password +resetPasswordExpire');

            // 4. Token validation
            if (!customer) {
                console.log('Token validation failed for:', hashedToken);
                return responseReturn(res, 400, {
                    error: 'Invalid or expired token',
                    code: 'INVALID_TOKEN'
                });
            }

            // 5. Password validation
            const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
            if (!passwordRegex.test(newPassword)) {
                return responseReturn(res, 400, {
                    error: 'Password requirements not met',
                    requirements: [
                        '8+ characters',
                        '1 uppercase letter',
                        '1 number',
                        '1 special character (@$!%*?&)'
                    ],
                    code: 'WEAK_PASSWORD'
                });
            }

            // 6. Password history check
            const isReused = await bcrypt.compare(newPassword, customer.password);
            if (isReused) {
                return responseReturn(res, 400, {
                    error: 'Cannot reuse previous password',
                    code: 'PASSWORD_REUSE'
                });
            }

            // 7. Update password
            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await customerModel.findByIdAndUpdate(customer._id, {
                password: hashedPassword,
                tokenVersion: customer.tokenVersion + 1,
                resetPasswordToken: undefined,
                resetPasswordExpire: undefined
            }, { new: true, runValidators: true });

            // 8. Invalidate existing sessions
            res.clearCookie('customerToken');

            return responseReturn(res, 200, {
                message: 'Password updated successfully',
                requiresReauth: true
            });

        } catch (error) {
            console.error('Password Reset Error:', error);
            return responseReturn(res, 500, {
                error: 'Password reset failed',
                code: 'SERVER_ERROR',
                details: process.env.NODE_ENV === 'development' ? error.message : undefined
            });
        }
    }

    customer_logout = async (req, res) => {
        res.cookie('customerToken', "", {
            expires: new Date(Date.now())
        });
        responseReturn(res, 200, { message: 'Logout success' });
    }
}
module.exports = new customerAuthController();