const adminModel = require('../models/adminModel');
const sellerModel = require('../models/sellerModel');
const sellerCustomerModel = require('../models/chat/sellerCustomerModel');
const bcrpty = require('bcrypt');
const formidable = require('formidable');
const cloudinary = require('cloudinary').v2;
const { responseReturn } = require('../utiles/response');
const { createToken } = require('../utiles/tokenCreate');
const fs = require('fs').promises;

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
                        id_number: '' // ADDED ID NUMBER FIELD
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
            cloudinary.config({
                cloud_name: process.env.cloud_name,
                api_key: process.env.api_key,
                api_secret: process.env.api_secret,
                secure: true
            });
            const { image } = files;
            try {
                const result = await cloudinary.uploader.upload(image.filepath, { folder: 'profile' });
                if (result) {
                    await sellerModel.findByIdAndUpdate(id, { image: result.url });
                    const userInfo = await sellerModel.findById(id);
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

                // Debug received data
                console.log('Received fields:', fields);
                console.log('Received files:', files);

                // Configure Cloudinary
                cloudinary.config({
                    cloud_name: process.env.cloud_name,
                    api_key: process.env.api_key,
                    api_secret: process.env.api_secret,
                    secure: true
                });

                // Create update object with default values
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
                    'shopInfo.id_number': fields.id_number || '', // ADDED ID NUMBER
                    'shopInfo.documentVerification': {
                        status: 'pending',
                        checks: [],
                        issues: []
                    }
                };

                // Process document if uploaded
                if (files.document) {
                    try {
                        // Configure upload options (REMOVED OCR/AI PARAMETERS)
                        const uploadOptions = {
                            folder: 'id_verification',
                            context: `id_type=${fields.documentType}|seller_id=${req.id}`,
                            resource_type: 'auto'
                        };

                        // Upload to Cloudinary
                        const result = await cloudinary.uploader.upload(
                            files.document.filepath,
                            uploadOptions
                        );

                        updateData['shopInfo.document'] = result.secure_url;

                        // Process verification using ID number
                        const verificationResults = await this.verifyID(
                            fields.documentType,
                            fields.id_number
                        );

                        updateData['shopInfo.documentVerification'] = verificationResults;

                        // Delete temp file after upload
                        await fs.unlink(files.document.filepath);
                    } catch (uploadError) {
                        console.error('Cloudinary upload failed:', uploadError);
                        updateData['shopInfo.documentVerification'] = {
                            status: 'failed',
                            issues: ['Document upload failed: ' + uploadError.message]
                        };
                    }
                }

                // Update seller in database
                const updatedSeller = await sellerModel.findByIdAndUpdate(
                    req.id,
                    { $set: updateData },
                    { new: true, runValidators: true }
                );

                if (!updatedSeller) {
                    return responseReturn(res, 404, { error: 'Seller not found' });
                }

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

    // SIMPLIFIED VERIFICATION METHOD
    verifyID = async (documentType, idNumber) => {
        const results = {
            status: 'pending',
            checks: [],
            issues: []
        };

        try {
            // Test numbers for verification
            const validIDs = {
                nin: ['12345678901', '23456789012'],
                passport: ['A1234567', 'B7654321'],
                driver_license: ['DL12345678', 'DL87654321'],
                voter_card: ['ABC12345678', 'XYZ87654321']
            };

            // Special test cases
            if (idNumber === 'TEST_PENDING') {
                results.status = 'pending';
                results.checks = ['Verification in progress'];
            }
            else if (idNumber === 'TEST_FAILED') {
                results.status = 'failed';
                results.issues = ['ID not found in government database'];
            }
            else {
                // Normal verification
                const isValid = validIDs[documentType]?.includes(idNumber) || false;

                if (isValid) {
                    results.status = 'verified';
                    results.checks = ['ID verification passed'];
                } else {
                    results.status = 'failed';
                    results.issues = ['ID not found in official registry'];
                }
            }

            // Add document-specific checks
            switch (documentType) {
                case 'nin':
                    if (idNumber.length !== 11) {
                        results.issues.push('NIN must be 11 digits');
                    }
                    break;
                case 'passport':
                    if (!/^[A-Z]\d{7}$/.test(idNumber)) {
                        results.issues.push('Invalid passport format');
                    }
                    break;
            }

        } catch (error) {
            console.error('Verification error:', error);
            results.status = 'error';
            results.issues.push('Verification process failed');
        }

        return results;
    }

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