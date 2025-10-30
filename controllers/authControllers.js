const adminModel = require('../models/adminModel');
const sellerModel = require('../models/sellerModel');
const sellerCustomerModel = require('../models/chat/sellerCustomerModel');
const bcrpty = require('bcrypt');
const formidable = require('formidable');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const { responseReturn } = require('../utiles/response');
const { createToken } = require('../utiles/tokenCreate');
const fs = require('fs').promises;
const FormData = require('form-data');
const AuditLog = require('../models/auditLogModel');
const jwt = require('jsonwebtoken');

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
    secure: true
});

class authControllers {

    logAction = async (req, action, entityType, entityId, details) => {
        try {
            await AuditLog.create({
                userId: req.id,                    // Required: ObjectId
                userType: req.role,                // Required: must be 'admin', 'seller', or 'system'
                action: action,                    // Required: string
                entityType: entityType,            // Required: must be from enum
                entityId: entityId,                // Optional: ObjectId
                details: details,                  // Optional: mixed data
                ipAddress: req.ip || 'unknown',    // Required: string
                userAgent: req.headers['user-agent'] || 'unknown',
                timestamp: new Date()
            });
        } catch (error) {
            console.error('Audit log creation failed:', error);
        }
    }

    refresh_token = async (req, res) => {
        const refreshToken = req.cookies.refreshToken;

        if (!refreshToken) {
            return res.status(401).json({ error: 'Refresh token missing' });
        }

        try {
            const payload = jwt.verify(refreshToken, process.env.REFRESH_SECRET);
            const accessToken = jwt.sign(
                {
                    sub: payload.sub,
                    role: payload.role,
                    status: payload.status
                },
                process.env.JWT_SECRET,
                { expiresIn: '15m' }
            );

            res.json({ accessToken });
        } catch (err) {
            res.status(401).json({ error: 'Invalid refresh token' });
        }
    }

    verify_token = async (req, res) => {
        const { token } = req.body;
        console.log('Received token for verification:', token ? token.substring(0, 20) + '...' : 'null');

        if (!token) {
            console.log('No token provided');
            return res.json({ valid: false });
        }

        try {
            console.log('Verifying token...');
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            console.log('Token valid. Decoded:', decoded);

            res.json({
                valid: true,
                user: {
                    id: decoded.id,
                    role: decoded.role,
                    status: decoded.status || 'active'
                }
            });
        } catch (err) {
            console.error('Token verification error:', err.message);
            res.json({ valid: false });
        }
    };

    admin_login = async (req, res) => {
        const { email, password } = req.body;
        try {
            const admin = await adminModel.findOne({ email }).select('+password');
            if (admin) {
                const match = await bcrpty.compare(password, admin.password);
                if (match) {
                    const token = createToken({
                        id: admin.id,
                        role: admin.role
                    });

                    const userInfo = {
                        _id: admin._id,
                        name: admin.name,
                        email: admin.email,
                        role: admin.role,
                        status: 'active',
                        image: admin.image || ''
                    };

                    res.cookie('accessToken', token, {
                        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                    });

                    responseReturn(res, 200, {
                        token,
                        message: 'Login success',
                        userInfo
                    });
                } else {
                    responseReturn(res, 404, { error: "Password wrong" });
                }
            } else {
                responseReturn(res, 404, { error: "Email not found" });
            }
        } catch (error) {
            responseReturn(res, 500, { error: error.message });
        }
    }

    seller_login = async (req, res) => {
        const { email, password } = req.body;
        try {
            const seller = await sellerModel.findOne({ email }).select('+password');
            if (seller) {
                const match = await bcrpty.compare(password, seller.password);
                if (match) {
                    const token = createToken({
                        id: seller.id,
                        role: seller.role,
                        status: seller.status
                    });

                    // Create sanitized user info with location
                    const userInfo = {
                        _id: seller._id,
                        name: seller.name,
                        email: seller.email,
                        role: seller.role,
                        status: seller.status,
                        image: seller.image || '',
                        location: seller.location || {},
                        shopInfo: {
                            shopName: seller.shopInfo?.shopName || '',
                            businessType: seller.shopInfo?.businessType || '',
                            division: seller.shopInfo?.division || '',
                            district: seller.shopInfo?.district || '',
                            sub_district: seller.shopInfo?.sub_district || '',
                            cacNumber: seller.shopInfo?.cacNumber || '',
                            tin: seller.shopInfo?.tin || '',
                            businessNumber: seller.shopInfo?.businessNumber || '',
                            document: seller.shopInfo?.document || '',
                            documentVerification: seller.shopInfo?.documentVerification || {}
                        }
                    };

                    res.cookie('accessToken', token, {
                        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                    });

                    responseReturn(res, 200, {
                        token,
                        message: 'Login success',
                        userInfo
                    });
                } else {
                    responseReturn(res, 404, { error: "Password wrong" });
                }
            } else {
                responseReturn(res, 404, { error: "Email not found" });
            }
        } catch (error) {
            responseReturn(res, 500, { error: error.message });
        }
    }

    seller_register = async (req, res) => {
        const { email, name, password } = req.body;
        try {
            console.log('Registration attempt for:', { email, name });

            const getUser = await sellerModel.findOne({ email });
            if (getUser) {
                return responseReturn(res, 409, { error: 'Email already exists' });
            }

            // Create seller with PROPER GEOJSON coordinates
            const seller = await sellerModel.create({
                name: name.trim(),
                email: email.toLowerCase().trim(),
                password: await bcrpty.hash(password, 10),
                role: 'seller',
                method: 'manually',
                status: 'pending',
                security: {
                    documentUploadCount: 0,
                    lastDocumentUpload: null,
                    verificationHistory: []
                },
                location: {
                    address: '',
                    city: '',
                    state: '',
                    country: 'Nigeria',
                    businessNumber: '',
                    coordinates: {
                        type: "Point",
                        coordinates: [0, 0] // Default coordinates [lng, lat]
                    },
                    geocodingSource: 'manual'
                },
                shopInfo: {
                    shopName: '',
                    division: '',
                    district: '',
                    sub_district: '',
                    businessType: 'small',
                    cacNumber: '',
                    companyName: '',
                    companyEmail: '',
                    tin: '',
                    businessNumber: '',
                    documentType: '',
                    document: '',
                    id_number: '',
                    documentVerification: {
                        status: 'pending',
                        checks: [],
                        issues: []
                    }
                }
            });

            console.log('Seller created with ID:', seller._id);

            // Create seller customer model
            await sellerCustomerModel.create({
                myId: seller._id
            });

            // Create token
            const token = createToken({
                id: seller._id.toString(),
                role: seller.role,
                status: seller.status
            });

            if (!token) {
                throw new Error('Token creation failed');
            }

            console.log('Token created successfully');

            // Prepare user info
            const userInfo = {
                _id: seller._id,
                name: seller.name,
                email: seller.email,
                role: seller.role,
                status: seller.status,
                image: seller.image || '',
                location: seller.location || {},
                shopInfo: {
                    shopName: seller.shopInfo?.shopName || '',
                    businessType: seller.shopInfo?.businessType || ''
                }
            };

            // Set cookie
            res.cookie('accessToken', token, {
                expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'lax'
            });

            // Log the registration
            await this.logAction(
                req,
                'SELLER_REGISTER',
                'seller',
                seller._id,
                { email: seller.email, status: seller.status }
            );

            console.log('Registration successful for:', seller.email);

            responseReturn(res, 201, {
                token,
                message: 'Registration successful',
                userInfo
            });

        } catch (error) {
            console.error('Registration error:', error);

            // Specific error handling
            if (error.name === 'ValidationError') {
                return responseReturn(res, 400, {
                    error: 'Validation failed: ' + Object.values(error.errors).map(e => e.message).join(', ')
                });
            }
            if (error.code === 11000) {
                return responseReturn(res, 409, {
                    error: 'Email already exists'
                });
            }

            responseReturn(res, 500, {
                error: 'Registration failed. Please try again.'
            });
        }
    }

    getUser = async (req, res) => {
        const { id, role } = req;
        try {
            if (role === 'admin') {
                const user = await adminModel.findById(id);
                responseReturn(res, 200, {
                    userInfo: {
                        _id: user._id,
                        name: user.name,
                        email: user.email,
                        role: user.role,
                        status: 'active',
                        image: user.image || ''
                    }
                });
            } else {
                const seller = await sellerModel.findById(id);
                // Return complete user info including location
                responseReturn(res, 200, {
                    userInfo: {
                        _id: seller._id,
                        name: seller.name,
                        email: seller.email,
                        role: seller.role,
                        status: seller.status,
                        image: seller.image || '',
                        location: seller.location || {},
                        shopInfo: {
                            shopName: seller.shopInfo?.shopName || '',
                            businessType: seller.shopInfo?.businessType || '',
                            division: seller.shopInfo?.division || '',
                            district: seller.shopInfo?.district || '',
                            sub_district: seller.shopInfo?.sub_district || '',
                            cacNumber: seller.shopInfo?.cacNumber || '',
                            tin: seller.shopInfo?.tin || '',
                            businessNumber: seller.shopInfo?.businessNumber || '',
                            document: seller.shopInfo?.document || '',
                            documentVerification: seller.shopInfo?.documentVerification || {}
                        }
                    }
                });
            }
        } catch (error) {
            responseReturn(res, 500, { error: 'Internal server error' });
        }
    }

    profile_image_upload = async (req, res) => {
        const { id } = req;
        const form = formidable({ multiples: true });
        form.parse(req, async (err, _, files) => {
            if (err) {
                return responseReturn(res, 400, { error: 'File upload error' });
            }

            try {
                const { image } = files;
                const result = await cloudinary.uploader.upload(image.filepath, {
                    folder: 'profile',
                    transformation: { quality: 'auto:best' }
                });

                if (result) {
                    await sellerModel.findByIdAndUpdate(id, { image: result.url });
                    const seller = await sellerModel.findById(id);

                    const userInfo = {
                        _id: seller._id,
                        name: seller.name,
                        email: seller.email,
                        role: seller.role,
                        status: seller.status,
                        image: seller.image || '',
                        location: seller.location || {},
                        shopInfo: {
                            shopName: seller.shopInfo?.shopName || '',
                            businessType: seller.shopInfo?.businessType || ''
                        }
                    };

                    responseReturn(res, 201, { message: 'Image upload success', userInfo });
                } else {
                    responseReturn(res, 404, { error: 'Image upload failed' });
                }
            } catch (error) {
                responseReturn(res, 500, { error: error.message });
            }
        });
    }

    profile_info_add = async (req, res) => {
        try {
            const form = formidable({ multiples: true });
            form.parse(req, async (err, fields, files) => {
                if (err) {
                    console.error('Form parsing error:', err);
                    return responseReturn(res, 400, { error: err.message });
                }

                console.log('Received fields:', {
                    shopName: fields.shopName,
                    division: fields.division,
                    district: fields.district,
                    sub_district: fields.sub_district,
                    latitude: fields.latitude,
                    longitude: fields.longitude,
                    geocodingSource: fields.geocodingSource,
                    formattedAddress: fields.formattedAddress
                });

                // Get seller
                let seller = await sellerModel.findById(req.id);
                if (!seller) {
                    return responseReturn(res, 404, { error: 'Seller not found' });
                }

                // Initialize security if missing
                if (!seller.security) {
                    seller.security = {
                        documentUploadCount: 0,
                        lastDocumentUpload: null,
                        verificationHistory: []
                    };
                }

                // Create update object for shop info
                const updateData = {
                    'shopInfo.shopName': fields.shopName || '',
                    'shopInfo.division': fields.division || '',
                    'shopInfo.district': fields.district || '',
                    'shopInfo.sub_district': fields.sub_district || '',
                    'shopInfo.businessType': fields.businessType || 'small',
                    'shopInfo.cacNumber': fields.cacNumber || '',
                    'shopInfo.tin': fields.tin || '',
                    'shopInfo.businessNumber': fields.businessNumber || '',
                    'shopInfo.documentVerification.status': 'pending'
                };

                // Handle location data - UPDATED: Use proper GeoJSON format
                if (fields.latitude && fields.longitude) {
                    console.log('Saving coordinates to database:', {
                        latitude: fields.latitude,
                        longitude: fields.longitude,
                        source: fields.geocodingSource
                    });

                    // Build complete location object for sellerModel with GeoJSON
                    const locationData = {
                        'location.address': fields.formattedAddress || fields.sub_district || '',
                        'location.city': fields.district || '',
                        'location.state': fields.division || '',
                        'location.country': 'Nigeria',
                        'location.businessNumber': fields.businessNumber || '',
                        'location.coordinates': {
                            type: "Point",
                            coordinates: [
                                parseFloat(fields.longitude), // Note: longitude first
                                parseFloat(fields.latitude)   // Then latitude
                            ]
                        },
                        'location.geocodingSource': fields.geocodingSource || 'manual'
                    };

                    // Merge location data with update data
                    Object.assign(updateData, locationData);
                }

                // File validation and processing
                if (files.document) {
                    const allowedMimes = ['image/jpeg', 'image/png', 'application/pdf'];
                    if (!allowedMimes.includes(files.document.mimetype)) {
                        await fs.unlink(files.document.filepath);
                        return responseReturn(res, 400, { error: 'Invalid file type. Only JPG, PNG, or PDF allowed' });
                    }

                    const maxSize = 5 * 1024 * 1024;
                    if (files.document.size > maxSize) {
                        await fs.unlink(files.document.filepath);
                        return responseReturn(res, 400, { error: 'File exceeds size limit of 5MB' });
                    }

                    try {
                        const uploadOptions = {
                            folder: process.env.NODE_ENV === 'production' ?
                                'prod_id_verification' : 'dev_id_verification',
                            resource_type: 'auto',
                            quality_analysis: true
                        };

                        const result = await cloudinary.uploader.upload(
                            files.document.filepath,
                            uploadOptions
                        );

                        updateData['shopInfo.document'] = result.secure_url;
                        updateData['shopInfo.documentVerification'] = {
                            status: 'pending',
                            checks: [],
                            issues: ['Verification pending']
                        };

                        // Track upload activity
                        updateData['security.documentUploadCount'] = (seller.security.documentUploadCount || 0) + 1;
                        updateData['security.lastDocumentUpload'] = new Date();

                        await fs.unlink(files.document.filepath);
                    } catch (uploadError) {
                        console.error('Document processing failed:', uploadError);
                        updateData['shopInfo.documentVerification'] = {
                            status: 'error',
                            issues: ['Processing failed: ' + uploadError.message]
                        };
                    }
                }

                console.log('Final update data for sellerModel:', JSON.stringify(updateData, null, 2));

                // Update seller in database
                const updatedSeller = await sellerModel.findByIdAndUpdate(
                    req.id,
                    { $set: updateData },
                    {
                        new: true,
                        runValidators: true,
                        upsert: false
                    }
                );

                if (!updatedSeller) {
                    return responseReturn(res, 500, { error: 'Failed to update seller' });
                }

                console.log('Seller updated successfully. Location data:', updatedSeller.location);

                // Create sanitized user info for response
                const userInfo = {
                    _id: updatedSeller._id,
                    name: updatedSeller.name,
                    email: updatedSeller.email,
                    role: updatedSeller.role,
                    status: updatedSeller.status,
                    image: updatedSeller.image || '',
                    location: updatedSeller.location || {},
                    shopInfo: {
                        shopName: updatedSeller.shopInfo?.shopName || '',
                        businessType: updatedSeller.shopInfo?.businessType || '',
                        division: updatedSeller.shopInfo?.division || '',
                        district: updatedSeller.shopInfo?.district || '',
                        sub_district: updatedSeller.shopInfo?.sub_district || '',
                        cacNumber: updatedSeller.shopInfo?.cacNumber || '',
                        tin: updatedSeller.shopInfo?.tin || '',
                        businessNumber: updatedSeller.shopInfo?.businessNumber || '',
                        document: updatedSeller.shopInfo?.document || null,
                        documentVerification: updatedSeller.shopInfo?.documentVerification || {}
                    }
                };

                // Audit log
                await this.logAction(
                    req,
                    'PROFILE_UPDATE',
                    'seller',
                    req.id,
                    {
                        shopName: fields.shopName,
                        locationUpdated: !!(fields.latitude && fields.longitude),
                        coordinates: fields.latitude && fields.longitude ?
                            `Lat: ${fields.latitude}, Lng: ${fields.longitude}` : 'none',
                        geocodingSource: fields.geocodingSource || 'none',
                        fileUploaded: !!files.document
                    }
                );

                responseReturn(res, 200, {
                    message: 'Profile info updated successfully',
                    userInfo
                });
            });
        } catch (error) {
            console.error('Profile update error:', error);
            responseReturn(res, 500, { error: 'Internal server error: ' + error.message });
        }
    };

    scanForMalware = async (filePath) => {
        if (process.env.NODE_ENV === 'production' && process.env.VIRUSTOTAL_API_KEY) {
            try {
                const formData = new FormData();
                formData.append('file', fs.createReadStream(filePath));

                const response = await axios.post(
                    'https://www.virustotal.com/api/v3/files',
                    formData,
                    {
                        headers: {
                            'x-apikey': process.env.VIRUSTOTAL_API_KEY,
                            ...formData.getHeaders()
                        }
                    }
                );

                return response.data.data.attributes.status === 'clean' ?
                    { status: 'clean' } :
                    { status: 'infected', details: 'Malware detected' };
            } catch (error) {
                console.error('Virus scan failed:', error);
                return { status: 'error', details: 'Scan failed' };
            }
        } else {
            return { status: 'clean' };
        }
    };


    create_inquiry = async (req, res) => {
        const { id } = req;

        try {
            const seller = await sellerModel.findById(id);
            if (!seller) {
                return responseReturn(res, 404, { error: 'Seller not found' });
            }

            if (!process.env.PERSONA_API_KEY || !process.env.PERSONA_TEMPLATE_ID) {
                return responseReturn(res, 500, {
                    error: 'Persona configuration missing - check environment variables'
                });
            }

            const response = await axios.post(
                'https://api.sandbox.withpersona.com/v1/inquiries',
                {
                    data: {
                        type: 'inquiry',
                        attributes: {
                            inquiry_template_id: process.env.PERSONA_TEMPLATE_ID,
                            reference_id: id,
                            fields: {
                                name: seller.name,
                                email: seller.email
                            }
                        }
                    }
                },
                {
                    headers: {
                        'Authorization': `Bearer ${process.env.PERSONA_API_KEY}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Persona-Version': '2023-01-05'
                    },
                    timeout: 10000
                }
            );

            if (response.data.data?.attributes?.hosted_url) {
                return responseReturn(res, 200, {
                    hostedUrl: response.data.data.attributes.hosted_url
                });
            } else {
                return responseReturn(res, 500, {
                    error: 'Persona response missing hosted URL'
                });
            }

        } catch (error) {
            console.error('Persona API error:', error.response?.data || error.message);

            let errorMessage = 'Unable to create verification session';
            if (error.response?.data?.errors) {
                errorMessage += `: ${error.response.data.errors.map(e => e.detail).join(', ')}`;
            }

            return responseReturn(res, 500, { error: errorMessage });
        }
    };

    persona_webhook = async (req, res) => {
        const event = req.body;

        try {
            if (event.data.type === 'inquiry') {
                const inquiry = event.data;
                const referenceId = inquiry.attributes.reference_id;
                const status = inquiry.attributes.status;

                if (status === 'completed') {
                    const verificationStatus = inquiry.attributes.decision?.status === 'approved'
                        ? 'verified'
                        : 'failed';

                    await sellerModel.findByIdAndUpdate(
                        referenceId,
                        {
                            'shopInfo.documentVerification.status': verificationStatus,
                            'shopInfo.documentVerification.lastVerified': new Date()
                        }
                    );

                    console.log(`Updated verification status for seller ${referenceId}: ${verificationStatus}`);
                }
            }

            res.status(200).json({ received: true });
        } catch (error) {
            console.error('Persona webhook error:', error);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    };

    logout = async (req, res) => {
        try {
            res.cookie('accessToken', null, {
                expires: new Date(Date.now()),
                httpOnly: true
            });
            responseReturn(res, 200, { message: 'Logout success' });
        } catch (error) {
            responseReturn(res, 500, { error: error.message });
        }
    }
}

module.exports = new authControllers();