require('dotenv').config();
const mongoose = require('mongoose');
const sellerModel = require('./models/sellerModel');
const flutterwaveController = require('./controllers/payment/flutterwaveController');

async function migrateSellers() {
    try {
        await mongoose.connect(process.env.DB_PRODUCTION_URL);
        console.log('Database connected');

        const sellers = await sellerModel.find({
            'flutterwaveDetails.subaccountId': { $exists: true },
            'flutterwaveDetails.recipientId': { $exists: false }
        });

        console.log(`Found ${sellers.length} sellers to migrate`);

        for (const seller of sellers) {
            console.log(`Migrating seller: ${seller._id}`);
            
            try {
                const req = { 
                    params: { sellerId: seller._id.toString() }
                };
                
                const res = {
                    status: () => ({
                        json: (data) => {
                            if (data.message) console.log(`Success: ${data.message}`);
                            else console.log(`Error: ${data.error}`);
                        }
                    })
                };

                await flutterwaveController.fix_seller_recipient(req, res);
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (err) {
                console.error(`Error migrating seller ${seller._id}:`, err.message);
            }
        }

        console.log('Migration complete');
        process.exit(0);
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    }
}

migrateSellers();