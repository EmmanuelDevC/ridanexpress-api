const striptModel = require('../../models/stripeModel')
const sellerModel = require('../../models/sellerModel')
const sellerWallet = require('../../models/sellerWallet')
const myShopWallet = require('../../models/myShopWallet')
const withdrowRequest = require('../../models/withdrowRequest')
const { responseReturn } = require('../../utiles/response')
const { mongo: { ObjectId } } = require('mongoose')
const axios = require('axios');
const { v4: uuidv4 } = require('uuid')
const stripe = require('stripe')(process.env.stripe_key)
const mode = process.env.mode

const flutterwaveController = require('.././dashboard/flutterwaveController');

class paymentController {

    create_stripe_connect_account = async (req, res) => {

        const { id } = req
        const uid = uuidv4()

        try {
            const stripInfo = await striptModel.findOne({ sellerId: id })

            if (stripInfo) {

                await striptModel.deleteOne({ sellerId: id })
                const account = await stripe.accounts.create({ type: 'express' })

                const accountLink = await stripe.accountLinks.create({
                    account: account.id,
                    refresh_url: mode === 'production' ? `${process.env.admin_panel_production_url}/refresh` : `${process.env.admin_panel_lcoal_url}/refresh`,
                    return_url: mode === 'production' ? `${process.env.admin_panel_production_url}/success?activeCode=${uid}` : `${process.env.admin_panel_lcoal_url}/success?activeCode=${uid}`,
                    type: 'account_onboarding'
                })
                await striptModel.create({
                    sellerId: id,
                    stripeId: account.id,
                    code: uid
                })
                responseReturn(res, 201, { url: accountLink.url })

            } else {
                const account = await stripe.accounts.create({ type: 'express' })

                const accountLink = await stripe.accountLinks.create({
                    account: account.id,
                    refresh_url: mode === 'production' ? `${process.env.admin_panel_production_url}/refresh` : `${process.env.admin_panel_lcoal_url}/refresh`,
                    return_url: mode === 'production' ? `${process.env.admin_panel_production_url}/success?activeCode=${uid}` : `${process.env.admin_panel_lcoal_url}/success?activeCode=${uid}`,
                    type: 'account_onboarding'
                })
                await striptModel.create({
                    sellerId: id,
                    stripeId: account.id,
                    code: uid
                })
                responseReturn(res, 201, { url: accountLink.url })
            }
        } catch (error) {
            console.log('stripe connect account create error ' + error.message)
        }
    }

    active_stripe_connect_account = async (req, res) => {
        const { activeCode } = req.params
        const { id } = req
        try {
            const userStripeInfo = await striptModel.findOne({ code: activeCode })
            if (userStripeInfo) {
                await sellerModel.findByIdAndUpdate(id, {
                    payment: 'active'
                })
                responseReturn(res, 200, { message: 'payment active' })
            } else {
                responseReturn(res, 404, { message: 'payment active failed' })
            }
        } catch (error) {
            responseReturn(res, 500, { message: 'Internal server error' })
        }
    }

    sunAmount = (data) => {
        let sum = 0;

        for (let i = 0; i < data.length; i++) {
            sum = sum + data[i].amount
        }
        return sum
    }

    get_seller_payemt_details = async (req, res) => {
        const { sellerId } = req.params

        try {
            const payments = await sellerWallet.find({ sellerId })

            const pendingWithdrows = await withdrowRequest.find({
                $and: [
                    {
                        sellerId: {
                            $eq: sellerId
                        }
                    }, {
                        status: {
                            $eq: 'pending'
                        }
                    }
                ]
            })

            const successWithdrows = await withdrowRequest.find({
                $and: [
                    {
                        sellerId: {
                            $eq: sellerId
                        }
                    }, {
                        status: {
                            $eq: 'success'
                        }
                    }
                ]
            })

            const pendingAmount = this.sunAmount(pendingWithdrows)
            const withdrowAmount = this.sunAmount(successWithdrows)
            const totalAmount = this.sunAmount(payments)

            let availableAmount = 0;

            if (totalAmount > 0) {
                availableAmount = totalAmount - (pendingAmount + withdrowAmount)
            }
            responseReturn(res, 200, {
                totalAmount,
                pendingAmount,
                withdrowAmount,
                availableAmount,
                successWithdrows,
                pendingWithdrows
            })

        } catch (error) {
            console.log(error.message)
        }
    }

    withdrowal_request = async (req, res) => {
        const { amount, sellerId } = req.body

        try {
            const withdrowal = await withdrowRequest.create({
                sellerId,
                amount: parseInt(amount)
            })
            responseReturn(res, 200, { withdrowal, message: 'withdrowal request send' })
        } catch (error) {
            responseReturn(res, 500, { message: 'Internal server error' })
        }
    }

    get_payment_request = async (req, res) => {

        try {
            const withdrowalRequest = await withdrowRequest.find({ status: 'pending' })
            responseReturn(res, 200, { withdrowalRequest })
        } catch (error) {
            responseReturn(res, 500, { message: 'Internal server error' })
        }
    }

    // ... other methods ...

    payment_request_confirm = async (req, res) => {
        const { paymentId } = req.body;

        try {
            const payment = await withdrowRequest.findById(paymentId);
            if (!payment) {
                return responseReturn(res, 404, { message: 'Payment request not found' });
            }

            const seller = await sellerModel.findById(payment.sellerId);
            if (!seller) {
                return responseReturn(res, 404, { message: 'Seller not found' });
            }

            // Detect environment mode
            const isTestMode = process.env.FLUTTERWAVE_SECRET_KEY.includes('TEST');
            const whitelistedIP = process.env.FLUTTERWAVE_WHITELISTED_IP; // Should be set to '102.89.22.255'

            // Test mode validations
            if (isTestMode) {
                // Validate amount (max ₦100,000 in test mode)
                if (payment.amount > 100000) {
                    return responseReturn(res, 400, {
                        message: `Test mode: Maximum transfer amount is ₦100,000 (requested ₦${payment.amount})`
                    });
                }

                // Validate test account numbers
                const validTestAccounts = Array.from({ length: 9 }, (_, i) => `069000003${i + 1}`);
                if (!validTestAccounts.includes(seller.flutterwaveDetails.accountNumber)) {
                    return responseReturn(res, 400, {
                        message: `Test mode: Use only test accounts (${validTestAccounts.join(', ')})`
                    });
                }
            }

            // Prepare transfer payload
            const transferPayload = {
                account_bank: seller.flutterwaveDetails.bankCode,
                account_number: seller.flutterwaveDetails.accountNumber,
                amount: isTestMode ? 100 : payment.amount, // Force ₦100 in test mode
                narration: `Payment to ${seller.name.substring(0, 49)}`, // Max 50 chars
                currency: 'NGN',
                reference: `PAY-${Date.now()}-${paymentId}`,
                beneficiary_name: seller.name.substring(0, 49) // REQUIRED FIELD
            };

            // Add meta only in live mode
            if (!isTestMode) {
                if (seller.flutterwaveDetails?.recipientId) {
                    transferPayload.beneficiary_id = seller.flutterwaveDetails.recipientId;
                }
                transferPayload.meta = [
                    {
                        merchant_id: process.env.FLUTTERWAVE_MERCHANT_ID,
                        seller_id: seller._id.toString()
                    }
                ];
            }

            console.log('Transfer payload:', JSON.stringify(transferPayload, null, 2));

            // Execute transfer with IP whitelisting header
            const transferResponse = await axios.post(
                'https://api.flutterwave.com/v3/transfers',
                transferPayload,
                {
                    headers: {
                        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
                        'Content-Type': 'application/json',
                        'x-forwarded-for': whitelistedIP // CRITICAL FOR IP WHITELISTING
                    },
                    timeout: 15000
                }
            );

            if (transferResponse.data.status === 'success') {
                // Update payment status
                await withdrowRequest.findByIdAndUpdate(paymentId, {
                    status: 'success',
                    flutterwaveRef: transferResponse.data.data.reference,
                    completedAt: Date.now()
                });

                return responseReturn(res, 200, {
                    message: 'Payment transferred successfully',
                    transferId: transferResponse.data.data.id
                });
            } else {
                console.error('Flutterwave transfer failed:', transferResponse.data);
                return responseReturn(res, 500, {
                    message: 'Transfer processing failed: ' +
                        (transferResponse.data.message || 'Unknown error')
                });
            }
        } catch (error) {
            console.error('Payment confirmation error:', {
                message: error.message,
                response: error.response?.data,
                request: error.config?.data ? JSON.parse(error.config.data) : null,
                stack: error.stack
            });

            // Handle specific error cases
            let statusCode = 500;
            let errorMessage = 'Transfer failed';

            if (error.response) {
                statusCode = error.response.status;

                if (statusCode === 400) {
                    errorMessage = 'Invalid request: ' +
                        (error.response.data.message || 'Check parameters');
                } else if (statusCode === 403) {
                    errorMessage = 'Forbidden: ' +
                        (error.response.data.message || 'Insufficient permissions');
                } else if (statusCode === 409) {
                    errorMessage = 'Duplicate transfer: ' +
                        (error.response.data.message || 'Reference already used');
                }
            } else if (error.request) {
                errorMessage = 'No response from Flutterwave API';
            }

            return responseReturn(res, statusCode, {
                error: errorMessage,
                details: error.response?.data || { message: error.message }
            });
        }
    }
}

module.exports = new paymentController()