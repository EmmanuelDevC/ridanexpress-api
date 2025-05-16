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
                const isSamePassword = await bcrypt.compare(newPassword, customer.password);
                if (isSamePassword) {
                    return responseReturn(res, 400, { error: 'New password must be different' });
                }

                updates.password = await bcrypt.hash(newPassword, 10);
                updates.tokenVersion = customer.tokenVersion + 1;
                securityUpdate = true;

                // Generate password reset token
                const resetToken = crypto.randomBytes(20).toString('hex');
                updates.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
                updates.resetPasswordExpire = Date.now() + 900000; // 15 minutes
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

            // Send security email if password changed
            if (securityUpdate) {
                const resetToken = crypto.randomBytes(20).toString('hex');
                await sendPasswordChangeEmail({
                    email: customer.email,
                    name: customer.name,
                    resetLink: `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`
                });
            }

            // Prepare response
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

    reset_password = async (req, res) => {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return responseReturn(res, 400, {
                error: 'Token and new password are required'
            });
        }

        try {
            const hashedToken = crypto.createHash('sha256')
                .update(token)
                .digest('hex');

            const customer = await customerModel.findOne({
                resetPasswordToken: hashedToken,
                resetPasswordExpire: { $gt: Date.now() }
            });

            if (!customer) {
                return responseReturn(res, 400, { error: 'Invalid or expired token' });
            }

            // Validate password strength
            const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
            if (!passwordRegex.test(newPassword)) {
                return responseReturn(res, 400, {
                    error: 'Password must contain 8+ chars with uppercase, number, and special character'
                });
            }

            // Check password history (add your implementation)
            const isReused = await bcrypt.compare(newPassword, customer.password);
            if (isReused) {
                return responseReturn(res, 400, {
                    error: 'Cannot reuse previous passwords'
                });
            }

            // Update password and security fields
            const updates = {
                password: await bcrypt.hash(newPassword, 10),
                tokenVersion: customer.tokenVersion + 1,
                resetPasswordToken: undefined,
                resetPasswordExpire: undefined
            };

            await customerModel.findByIdAndUpdate(customer._id, updates);

            responseReturn(res, 200, {
                message: 'Password reset successful. Please login again.',
                requiresReauth: true
            });

        } catch (error) {
            console.error('Password Reset Error:', error);
            responseReturn(res, 500, {
                error: 'Password reset failed. Please try again later.'
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