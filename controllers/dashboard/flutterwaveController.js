const axios = require('axios');
const sellerModel = require('../../models/sellerModel');
const { responseReturn } = require('../../utiles/response');

class flutterwaveController {
    constructor() {
        // Bind all methods to maintain proper 'this' context
        this.create_subaccount = this.create_subaccount.bind(this);
        this.findExistingRecipient = this.findExistingRecipient.bind(this);
        this.fix_seller_recipient = this.fix_seller_recipient.bind(this);
        this.verify_recipient = this.verify_recipient.bind(this);
        this.verifyBankDetails = this.verifyBankDetails.bind(this);
    }

    // Helper to detect environment mode
    get isTestMode() {
        return process.env.FLUTTERWAVE_SECRET_KEY.includes('TEST');
    }

    async findExistingRecipient(accountNumber, bankCode) {
        // Skip in test mode - beneficiaries not needed
        if (this.isTestMode) return null;

        try {
            let page = 1;
            const normalizedAccount = accountNumber.toString().trim();
            const normalizedBank = bankCode.toString().trim();

            while (true) {
                const response = await axios.get(
                    `https://api.flutterwave.com/v3/beneficiaries?page=${page}`,
                    {
                        headers: {
                            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                        }
                    }
                );

                if (response.data.status !== 'success') {
                    throw new Error('Failed to list recipients');
                }

                // Check for match
                const recipient = response.data.data.find(
                    r => 
                        r.account_number.trim() === normalizedAccount &&
                        r.account_bank.trim() === normalizedBank
                );

                if (recipient) return recipient;

                // Check if there are more pages
                if (page >= response.data.meta.page_info.total_pages) break;
                page++;
            }

            return null;
        } catch (error) {
            console.error('Recipient search error:', error.message);
            throw error;
        }
    }

    async create_subaccount(req, res) {
        const { id } = req;
        const { account_number, bank_code } = req.body;
        let subaccountResponse;

        try {
            const seller = await sellerModel.findById(id);
            if (!seller) {
                return responseReturn(res, 404, { error: 'Seller not found' });
            }

            // TEST MODE: Validate test account number
            if (this.isTestMode) {
                const validTestAccounts = ['0690000031', '0690000032', '0690000033'];
                if (!validTestAccounts.includes(account_number)) {
                    return responseReturn(res, 400, {
                        error: 'In test mode, use only test account numbers: 0690000031 or 0690000032'
                    });
                }
            }

            // Verify bank details (in test mode, returns placeholder)
            const accountName = this.isTestMode 
                ? "TEST_MODE_ACCOUNT" 
                : await this.verifyBankDetails(account_number, bank_code);

            let recipientId = null;
            
            // Only create beneficiaries in LIVE mode
            if (!this.isTestMode) {
                try {
                    const existingRecipient = await this.findExistingRecipient(account_number, bank_code);
                    if (existingRecipient) {
                        console.log(`Using existing recipient: ${existingRecipient.id}`);
                        recipientId = existingRecipient.id;
                    } else {
                        console.log('Creating new recipient...');
                        const recipientResponse = await axios.post(
                            'https://api.flutterwave.com/v3/beneficiaries',
                            {
                                account_number: account_number,
                                account_bank: bank_code,
                                beneficiary_name: accountName,
                                currency: 'NGN'
                            },
                            {
                                headers: {
                                    Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                                }
                            }
                        );

                        if (recipientResponse.data.status !== 'success') {
                            throw new Error(recipientResponse.data.message || 'Failed to create recipient');
                        }
                        recipientId = recipientResponse.data.data.id;
                    }
                } catch (findError) {
                    console.error('Recipient creation failed:', findError.message);
                    return responseReturn(res, 500, {
                        error: 'Recipient setup failed',
                        details: findError.response?.data || findError.message
                    });
                }
            }

            // Create subaccount (works in both modes)
            subaccountResponse = await axios.post(
                'https://api.flutterwave.com/v3/subaccounts',
                {
                    account_bank: bank_code,
                    account_number: account_number,
                    business_name: seller.shopInfo.shopName || seller.name,
                    business_email: seller.email,
                    business_contact: seller.name,
                    business_contact_mobile: seller.phone || '',
                    business_mobile: seller.phone || '',
                    country: 'NG',
                    split_type: 'percentage',
                    split_value: 0.95
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                    }
                }
            );

            // Save details with mode awareness
            await sellerModel.findByIdAndUpdate(id, {
                payment: 'active',
                flutterwaveDetails: {
                    subaccountId: subaccountResponse.data.data.id,
                    recipientId: recipientId,
                    accountNumber: account_number,
                    bankCode: bank_code,
                    bankName: subaccountResponse.data.data.bank_name,
                    recipientVerified: !this.isTestMode, // True in live only
                    mode: this.isTestMode ? 'test' : 'live'
                }
            });

            responseReturn(res, 200, {
                message: `Payment account activated in ${this.isTestMode ? 'TEST' : 'LIVE'} mode`,
                recipientId: recipientId,
                subaccountId: subaccountResponse.data.data.id
            });
            
        } catch (error) {
            // Rollback subaccount creation if it was created
            if (subaccountResponse?.data?.data?.id) {
                try {
                    await axios.delete(
                        `https://api.flutterwave.com/v3/subaccounts/${subaccountResponse.data.data.id}`,
                        {
                            headers: {
                                Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                            }
                        }
                    );
                    console.log('Rolled back subaccount creation');
                } catch (rollbackError) {
                    console.error('Subaccount rollback failed:', rollbackError.message);
                }
            }

            console.error('Flutterwave setup error:', {
                message: error.message,
                response: error.response?.data,
                stack: error.stack
            });

            responseReturn(res, 500, {
                error: 'Payment setup failed',
                details: this.isTestMode 
                    ? `Test mode error: ${error.message}` 
                    : error.response?.data?.message || error.message
            });
        }
    }

    async fix_seller_recipient(req, res) {
        // Skip in test mode - no beneficiary needed
        if (this.isTestMode) {
            return responseReturn(res, 400, {
                error: 'Beneficiary operations are not supported in test mode'
            });
        }

        const { sellerId } = req.params;
        try {
            const seller = await sellerModel.findById(sellerId);
            if (!seller || !seller.flutterwaveDetails) {
                return responseReturn(res, 404, { error: 'Seller not found or no Flutterwave details' });
            }

            const { accountNumber, bankCode } = seller.flutterwaveDetails;
            const accountName = await this.verifyBankDetails(accountNumber, bankCode);

            // First try to find existing recipient
            let recipientId;
            const existingRecipient = await this.findExistingRecipient(accountNumber, bankCode);
            if (existingRecipient) {
                recipientId = existingRecipient.id;
            } else {
                // Create new recipient if not found
                const recipientResponse = await axios.post(
                    'https://api.flutterwave.com/v3/beneficiaries',
                    {
                        account_number: accountNumber,
                        account_bank: bankCode,
                        beneficiary_name: accountName,
                        currency: 'NGN'
                    },
                    {
                        headers: {
                            Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                        }
                    }
                );
                recipientId = recipientResponse.data.data.id;
            }

            // Update seller with new recipient ID
            await sellerModel.findByIdAndUpdate(sellerId, {
                'flutterwaveDetails.recipientId': recipientId,
                'flutterwaveDetails.recipientVerified': true
            });

            responseReturn(res, 200, {
                message: 'Recipient fixed successfully',
                recipientId
            });
        } catch (error) {
            console.error('Fix recipient error:', error.response?.data || error.message);
            responseReturn(res, 500, {
                error: 'Failed to fix recipient',
                details: error.response?.data || error.message
            });
        }
    }

    async verify_recipient(req, res) {
        // Skip in test mode
        if (this.isTestMode) {
            return responseReturn(res, 400, {
                error: 'Recipient verification is not available in test mode'
            });
        }

        const { recipientId } = req.params;
        try {
            const response = await axios.get(
                `https://api.flutterwave.com/v3/beneficiaries/${recipientId}`,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                    }
                }
            );

            responseReturn(res, 200, response.data);
        } catch (error) {
            responseReturn(res, 500, {
                error: 'Recipient verification failed',
                details: error.response?.data
            });
        }
    }

    async verifyBankDetails(accountNumber, bankCode) {
        try {
            // Skip actual verification in test mode
            if (this.isTestMode) return "TEST_MODE_ACCOUNT";

            const response = await axios.post(
                'https://api.flutterwave.com/v3/accounts/resolve',
                {
                    account_number: accountNumber,
                    account_bank: bankCode
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                    }
                }
            );

            if (response.data.status !== 'success') {
                throw new Error(response.data.message || 'Bank verification failed');
            }

            return response.data.data.account_name;
        } catch (error) {
            console.error('Bank verification failed:', {
                status: error.response?.status,
                data: error.response?.data,
                message: error.message
            });
            throw new Error('Invalid bank account details');
        }
    }
}

module.exports = new flutterwaveController();