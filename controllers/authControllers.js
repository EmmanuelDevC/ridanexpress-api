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

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUD_NAME,
    api_key: process.env.API_KEY,
    api_secret: process.env.API_SECRET,
    secure: true
});

class authControllers {
    admin_login = async (req, res) => {
        const { email, password } = req.body;
        try {
            const admin = await adminModel.findOne({ email }).select('+password');
            if (admin) {
                const match = await bcrpty.compare(password, admin.password);
                if (match) {
                    const token = await createToken({
                        id: admin.id,
                        role: admin.role
                    });
                    res.cookie('accessToken', token, {
                        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                    });
                    responseReturn(res, 200, { token, message: 'Login success' });
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
        console.log('Received:', { email, password }); // ✅ Add this
        try {
            const seller = await sellerModel.findOne({ email }).select('+password');
            if (seller) {
                const match = await bcrpty.compare(password, seller.password);
                if (match) {
                    const token = await createToken({
                        id: seller.id,
                        role: seller.role
                    });
                    res.cookie('accessToken', token, {
                        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                    });
                    responseReturn(res, 200, { token, message: 'Login success' });
                } else {
                    responseReturn(res, 404, { error: "Password wrong" });
                }
            } else {
                responseReturn(res, 404, { error: "Email not found" });
            }
        } catch (error) {
            console.error("Login error:", error); // ✅ Log error details
            responseReturn(res, 500, { error: error.message });
        }
    }

    seller_register = async (req, res) => {
        const { email, name, password } = req.body;
        try {
            const getUser = await sellerModel.findOne({ email });
            if (getUser) {
                responseReturn(res, 404, { error: 'Email already exists' });
            } else {
                const seller = await sellerModel.create({
                    name,
                    email,
                    password: await bcrpty.hash(password, 10),
                    method: 'menualy',
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
                        postalCode: '',
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
                await sellerCustomerModel.create({
                    myId: seller.id
                });
                const token = await createToken({ id: seller.id, role: seller.role });
                res.cookie('accessToken', token, {
                    expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                });
                responseReturn(res, 201, { token, message: 'Register success' });
            }
        } catch (error) {
            responseReturn(res, 500, { error: 'Internal server error' });
        }
    }

    getUser = async (req, res) => {
        const { id, role } = req;
        try {
            if (role === 'admin') {
                const user = await adminModel.findById(id);
                responseReturn(res, 200, { userInfo: user });
            } else {
                const seller = await sellerModel.findById(id);
                responseReturn(res, 200, { userInfo: seller });
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
                    const userInfo = await sellerModel.findById(id);

                    // Audit log
                    await this.logAction(req, 'PROFILE_IMAGE_UPDATE', 'account', id, {
                        image_size: image.size,
                        image_type: image.mimetype
                    });

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

                // File validation
                if (files.document) {
                    // File type validation
                    const allowedMimes = ['image/jpeg', 'image/png', 'application/pdf'];
                    if (!allowedMimes.includes(files.document.mimetype)) {
                        await fs.unlink(files.document.filepath);
                        return responseReturn(res, 400, { error: 'Invalid file type' });
                    }

                    // File size validation
                    const maxSize = process.env.DOCUMENT_MAX_SIZE || 5 * 1024 * 1024; // 5MB
                    if (files.document.size > maxSize) {
                        await fs.unlink(files.document.filepath);
                        return responseReturn(res, 400, { error: 'File exceeds size limit' });
                    }

                    // Check upload limits
                    const seller = await sellerModel.findById(req.id);
                    if (seller.security.documentUploadCount >= 3) {
                        const lastUpload = seller.security.lastDocumentUpload;
                        const hoursSinceLast = (new Date() - lastUpload) / (1000 * 60 * 60);

                        if (hoursSinceLast < 24) {
                            await fs.unlink(files.document.filepath);
                            return responseReturn(res, 429, {
                                error: 'Document upload limit exceeded. Try again tomorrow.'
                            });
                        }
                    }

                    // Malware scan
                    const scanResult = await this.scanForMalware(files.document.filepath);
                    if (scanResult.status !== 'clean') {
                        await fs.unlink(files.document.filepath);
                        return responseReturn(res, 422, {
                            error: scanResult.details || 'File security check failed'
                        });
                    }
                }

                // Create update object
                const updateData = {
                    'shopInfo.shopName': fields.shopName || '',
                    'shopInfo.division': fields.division || '',
                    'shopInfo.district': fields.district || '',
                    'shopInfo.sub_district': fields.sub_district || '',
                    'shopInfo.businessType': fields.businessType || 'small',
                    'shopInfo.cacNumber': fields.cacNumber || '',
                    'shopInfo.tin': fields.tin || '',
                    'shopInfo.postalCode': fields.postalCode || '',
                    'shopInfo.documentType': fields.documentType || '',
                    'shopInfo.id_number': fields.id_number || '',
                    'shopInfo.documentVerification': {
                        status: 'pending',
                        checks: [],
                        issues: []
                    }
                };

                // Process document if uploaded
                let documentUrl = '';
                if (files.document) {
                    try {
                        // Configure upload options
                        const uploadOptions = {
                            folder: process.env.NODE_ENV === 'production' ?
                                'prod_id_verification' : 'dev_id_verification',
                            context: `id_type=${fields.documentType}|seller_id=${req.id}|verification=required`,
                            resource_type: 'auto',
                            moderation: 'manual', // Enable Cloudinary manual review
                            quality_analysis: true
                        };

                        // Upload to Cloudinary
                        const result = await cloudinary.uploader.upload(
                            files.document.filepath,
                            uploadOptions
                        );

                        documentUrl = result.secure_url;
                        updateData['shopInfo.document'] = documentUrl;

                        // Process verification with Dojah
                        const verificationResults = await this.verifyWithDojah(
                            fields.documentType,
                            fields.id_number,
                            documentUrl
                        );

                        updateData['shopInfo.documentVerification'] = verificationResults;

                        // ===== DOCUMENT METADATA UPDATES =====
                        // Set expiration date (default 1 year)
                        const expiryDays = parseInt(process.env.DOCUMENT_EXPIRY_DAYS) || 365;
                        updateData['shopInfo.documentExpiration'] = new Date(
                            Date.now() + expiryDays * 24 * 60 * 60 * 1000
                        );

                        // Store verification ID if available
                        if (verificationResults.verificationId) {
                            updateData['shopInfo.documentVerification.verificationId'] =
                                verificationResults.verificationId;
                        }

                        // Update verification history
                        updateData.$push = {
                            'security.verificationHistory': {
                                timestamp: new Date(),
                                status: verificationResults.status,
                                service: 'dojah',
                                verificationId: verificationResults.verificationId || null
                            }
                        };

                        // Track upload activity
                        updateData.$inc = { 'security.documentUploadCount': 1 };
                        updateData['security.lastDocumentUpload'] = new Date();
                        // ===== END METADATA UPDATES =====

                        // Delete temp file after upload
                        await fs.unlink(files.document.filepath);
                    } catch (uploadError) {
                        console.error('Document processing failed:', uploadError);
                        updateData['shopInfo.documentVerification'] = {
                            status: 'error',
                            issues: ['Processing failed: ' + uploadError.message]
                        };
                    }
                }

                // Prepare update command
                const updateCommand = {
                    $set: updateData
                };

                // Add operators if defined
                if (updateData.$push) {
                    updateCommand.$push = updateData.$push;
                }
                if (updateData.$inc) {
                    updateCommand.$inc = updateData.$inc;
                }

                // Update seller in database
                const updatedSeller = await sellerModel.findByIdAndUpdate(
                    req.id,
                    updateCommand,
                    { new: true, runValidators: true }
                );

                if (!updatedSeller) {
                    return responseReturn(res, 404, { error: 'Seller not found' });
                }

                // Audit log
                await this.logAction(
                    req,
                    'PROFILE_UPDATE',
                    'seller',
                    req.id,
                    {
                        documentType: fields.documentType,
                        verificationStatus: updateData['shopInfo.documentVerification'].status,
                        fileUploaded: !!files.document
                    }
                );

                responseReturn(res, 200, {
                    message: 'Profile info updated successfully',
                    userInfo: updatedSeller
                });
            });
        } catch (error) {
            console.error('Profile update error:', error);
            responseReturn(res, 500, { error: error.message });
        }
    };

    // Virus scanning
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
            // Skip scanning in development
            return { status: 'clean' };
        }
    };

    // Dojah verification
    verifyWithDojah = async (documentType, idNumber, documentUrl) => {
        const results = {
            status: 'pending',
            checks: [],
            issues: [],
            verificationId: ''
        };

        try {
            // Skip in development if no API keys
            if (process.env.NODE_ENV !== 'production' &&
                (!process.env.DOJAH_APP_ID || !process.env.DOJAH_SECRET_KEY)) {
                results.checks.push('Skipped in development');
                return results;
            }

            // Map document types to Dojah types
            const dojahTypes = {
                national_id: 'NIN',
                passport: 'PASSPORT',
                driver_license: 'DRIVER_LICENSE',
                voter_card: 'VOTER_ID'
            };

            if (!dojahTypes[documentType]) {
                results.status = 'manual_review';
                results.issues.push('Document type not supported for auto-verification');
                return results;
            }

            // Prepare Dojah request
            const payload = {
                document_type: dojahTypes[documentType],
                document_number: idNumber,
                image_url: documentUrl,
                country: 'NG' // Nigeria
            };

            // Call Dojah API
            const response = await axios.post(
                'https://api.dojah.io/api/v1/document/verification',
                payload,
                {
                    headers: {
                        'AppId': process.env.DOJAH_APP_ID,
                        'Authorization': process.env.DOJAH_SECRET_KEY,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const verificationData = response.data;

            // Handle Dojah response
            if (verificationData.status === 'verified') {
                results.status = 'verified';
                results.checks = ['Document validated by Dojah'];

                // Additional checks
                if (verificationData.data.expiry_date) {
                    const expiry = new Date(verificationData.data.expiry_date);
                    if (expiry < new Date()) {
                        results.issues.push('Document has expired');
                        results.status = 'failed';
                    } else {
                        results.checks.push('Document is valid');
                    }
                }

                // Add validation details
                if (verificationData.validation) {
                    Object.entries(verificationData.validation).forEach(([key, valid]) => {
                        if (valid) {
                            results.checks.push(`${key.replace(/_/g, ' ')} validated`);
                        } else {
                            results.issues.push(`${key.replace(/_/g, ' ')} mismatch`);
                        }
                    });
                }
            } else if (verificationData.status === 'pending') {
                results.status = 'manual_review';
                results.checks = ['Document submitted for manual review'];
            } else {
                results.status = 'failed';
                results.issues = verificationData.errors || ['Verification failed'];
            }
        } catch (error) {
            console.error('Dojah verification error:', error);
            results.status = 'error';

            if (error.response) {
                const dojahError = error.response.data;
                if (dojahError.error === 'Insufficient balance') {
                    results.issues.push('Verification service temporarily unavailable');
                } else if (dojahError.error === 'Invalid document type') {
                    results.issues.push('Unsupported document type');
                } else {
                    results.issues.push(`Dojah error: ${dojahError.message}`);
                }
            } else {
                results.issues.push('Verification service unavailable');
            }
        }

        return results;
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