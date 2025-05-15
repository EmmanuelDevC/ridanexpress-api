const customerModel = require('../../models/customerModel');
const { responseReturn } = require('../../utiles/response');
const { createToken } = require('../../utiles/tokenCreate');
const sellerCustomerModel = require('../../models/chat/sellerCustomerModel');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { Types } = require('mongoose');
const sendVerificationEmail = require('../../utiles/emailSender'); // Add email sender

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
        const { name, email, password } = req.body;

        // Enhanced ID validation
        if (!Types.ObjectId.isValid(id)) {
            return responseReturn(res, 400, {
                error: 'Invalid user ID format',
                details: `Received invalid ID: ${id}`
            });
        }

        try {
            const updates = {};
            // Add field-specific validation
            if (name && typeof name === 'string') {
                updates.name = name.trim();
            }

            if (email && typeof email === 'string') {
                updates.email = email.toLowerCase().trim();
            }

            if (password && typeof password === 'string') {
                if (password.length < 8) {
                    return responseReturn(res, 400, {
                        error: 'Password must be at least 8 characters'
                    });
                }
                updates.password = await bcrypt.hash(password, 10);
            }

            // Add debug logging
            console.log('Attempting update with ID:', id);
            console.log('Update payload:', updates);

            const updatedUser = await customerModel.findByIdAndUpdate(
                id,
                { $set: updates },
                {
                    new: true,
                    runValidators: true,
                    // Add projection to ensure consistent response
                    select: '_id name email verified'
                }
            ).lean();

            if (!updatedUser) {
                console.error('Update failed - user not found with ID:', id);
                return responseReturn(res, 404, { error: 'User not found' });
            }

            // Convert MongoDB _id to string for consistency
            updatedUser.id = updatedUser._id.toString();
            delete updatedUser._id;

            responseReturn(res, 200, {
                message: 'Profile updated successfully',
                user: updatedUser
            });

        } catch (error) {
            console.error('Update Error:', error);
            const errorMessage = error.name === 'ValidationError'
                ? error.message
                : 'Update failed due to server error';

            responseReturn(res, 500, {
                error: errorMessage,
                ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
            });
        }
    }

    // customer_login = async (req, res) => {
    //     const { email, password } = req.body;
    //     try {
    //         const customer = await customerModel.findOne({ email }).select('+password');
    //         if (customer) {
    //             // Check verification status
    //             if (!customer.verified) {
    //                 return responseReturn(res, 403, {
    //                     error: 'Email not verified. Check your inbox or resend verification.'
    //                 });
    //             }

    //             const match = await bcrypt.compare(password, customer.password);
    //             if (match) {
    //                 const token = await createToken({
    //                     id: customer.id,
    //                     name: customer.name,
    //                     email: customer.email,
    //                     method: customer.method
    //                 });
    //                 res.cookie('customerToken', token, {
    //                     expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    //                 });
    //                 responseReturn(res, 200, { message: 'Login success', token });
    //             } else {
    //                 responseReturn(res, 401, { error: "Incorrect password" });
    //             }
    //         } else {
    //             responseReturn(res, 404, { error: 'Email not found' });
    //         }
    //     } catch (error) {
    //         console.log(error.message);
    //         responseReturn(res, 500, { error: 'Server error' });
    //     }
    // }

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

    customer_logout = async (req, res) => {
        res.cookie('customerToken', "", {
            expires: new Date(Date.now())
        });
        responseReturn(res, 200, { message: 'Logout success' });
    }
}
module.exports = new customerAuthController();