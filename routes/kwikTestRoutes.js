// Add this temporary test route to your orderRoutes.js
router.get('/test-kwik-integration', async (req, res) => {
    try {
        // Test Kwik service connection
        await KwikService.authenticate();
        
        // Test creating a simple delivery
        const testResult = await KwikService.createDeliveryTask({
            pickup: {
                address: "Test Seller Address, Lagos",
                name: "Test Seller",
                phone: "08000000000",
                email: "test@seller.com",
                time: new Date().toISOString().replace('T', ' ').substring(0, 19)
            },
            delivery: {
                address: "Test Customer Address, Lagos", 
                name: "Test Customer",
                phone: "08000000001",
                email: "test@customer.com",
                time: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').substring(0, 19)
            },
            amount: 1000,
            vehicleId: 1,
            isCOD: false,
            isInsured: true,
            instructions: "Test delivery",
            autoAssign: true
        });

        responseReturn(res, 200, {
            success: true,
            message: 'Kwik integration test successful',
            result: testResult
        });
    } catch (error) {
        console.error('Kwik test error:', error);
        responseReturn(res, 500, {
            success: false,
            error: error.message
        });
    }
});