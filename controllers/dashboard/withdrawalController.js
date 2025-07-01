const axios = require('axios');
const sellerModel = require('../models/sellerModel');

class withdrawalController {
    async initiateWithdrawal(req, res) {
        const { id } = req; // Seller ID
        const { amount } = req.body;
        
        try {
            const seller = await sellerModel.findById(id);
            if (!seller || !seller.flutterwaveDetails) {
                return responseReturn(res, 400, { error: 'Seller account not properly set up' });
            }

            const response = await axios.post(
                'https://api.flutterwave.com/v3/transfers',
                {
                    account_bank: seller.flutterwaveDetails.bankCode,
                    account_number: seller.flutterwaveDetails.accountNumber,
                    amount: amount,
                    narration: "Seller payout",
                    currency: "NGN",
                    reference: `payout-${Date.now()}-${id}`,
                    subaccount: seller.flutterwaveDetails.subaccountId
                },
                {
                    headers: {
                        Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`
                    }
                }
            );

            // Save withdrawal record in your database
            // ...

            responseReturn(res, 200, { 
                message: 'Withdrawal initiated successfully',
                transaction: response.data.data
            });
        } catch (error) {
            console.error('Withdrawal error:', error.response?.data || error.message);
            responseReturn(res, 500, { 
                error: 'Withdrawal failed',
                details: error.response?.data || error.message
            });
        }
    }
}

module.exports = new withdrawalController();