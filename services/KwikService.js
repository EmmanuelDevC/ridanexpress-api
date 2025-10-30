const axios = require('axios');

class KwikService {
    constructor() {
        this.baseURL = process.env.KWIK_BASE_URL || 'https://staging-api-test.kwik.delivery';
        this.token = null;
        this.tokenExpiry = null;
        this.isAuthenticated = false;
        this.vendorId = null;
        this.userId = 1;
        this.formId = 2;
        this.retryCount = 3;
        this.retryDelay = 1000;

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: 30000,
            headers: {
                'Content-Type': 'application/json',
            }
        });

        // Request interceptor
        this.client.interceptors.request.use(
            async (config) => {
                if (!this.isAuthenticated || this.isTokenExpired()) {
                    await this.authenticate();
                }
                console.log(`[KWIK] ${config.method?.toUpperCase()} ${config.url}`);
                return config;
            },
            (error) => {
                console.error('[KWIK] Request interceptor error:', error);
                return Promise.reject(error);
            }
        );

        // Response interceptor
        this.client.interceptors.response.use(
            (response) => {
                return response;
            },
            async (error) => {
                console.error('[KWIK] API Error:', error.response?.data || error.message);
                return Promise.reject(error);
            }
        );
    }

    isTokenExpired() {
        return this.tokenExpiry && Date.now() >= (this.tokenExpiry - 300000);
    }

    async authenticate() {
        try {
            console.log('[KWIK] Authenticating...');

            const response = await axios.post(`${this.baseURL}/vendor_login`, {
                domain_name: process.env.KWIK_DOMAIN,
                email: process.env.KWIK_EMAIL,
                password: process.env.KWIK_PASSWORD,
                api_login: 1
            });

            if (response.data.status === 200) {
                this.token = response.data.data.access_token;
                this.vendorId = response.data.data.vendor_details.vendor_id;
                this.tokenExpiry = Date.now() + (55 * 60 * 1000);
                this.isAuthenticated = true;

                console.log('[KWIK] Authentication successful', { vendorId: this.vendorId });
                return { success: true, vendor_id: this.vendorId, token: this.token };
            } else {
                throw new Error(`Authentication failed: ${response.data.message}`);
            }
        } catch (error) {
            console.error('[KWIK] Authentication failed:', error.message);
            this.isAuthenticated = false;
            return { success: false, error: error.message };
        }
    }

    // ==================== VEHICLE & LOADER METHODS ====================

    async getVehicleOptions(size = 0) {
        try {
            if (!this.isAuthenticated) {
                await this.authenticate();
            }

            const response = await this.client.get('/getVehicle', {
                params: {
                    access_token: this.token,
                    is_vendor: 1,
                    size: parseInt(size)
                }
            });

            return {
                success: true,
                vehicles: response.data.data || [],
                message: response.data.message
            };
        } catch (error) {
            console.error('[KWIK] Get vehicle options failed:', error.message);
            return {
                success: false,
                error: this.sanitizeErrorMessage(error),
                vehicles: []
            };
        }
    }

    async getLoaderOptions() {
        try {
            if (!this.isAuthenticated) {
                await this.authenticate();
            }

            const response = await this.client.get('/getLoaderList', {
                params: {
                    access_token: this.token,
                    is_vendor: 1
                }
            });

            return {
                success: true,
                loaders: response.data.data?.loaderInfo || [],
                is_loaders_enabled: response.data.data?.is_loaders_enabled || 0,
                message: response.data.message
            };
        } catch (error) {
            console.error('[KWIK] Get loader options failed:', error.message);
            return {
                success: false,
                error: this.sanitizeErrorMessage(error),
                loaders: [],
                is_loaders_enabled: 0
            };
        }
    }

    // ==================== ENHANCED PRICING CALCULATION ====================

    async getEnhancedBillBreakdown(pickup, delivery, options = {}) {
        try {
            // Geocode both addresses in parallel
            const [pickupGeocode, deliveryGeocode] = await Promise.all([
                this.geocodeWithFallback(pickup.address, pickup.latitude, pickup.longitude),
                this.geocodeWithFallback(delivery.address, delivery.latitude, delivery.longitude)
            ]);

            if (!pickupGeocode.success || !deliveryGeocode.success) {
                throw new Error(`Geocoding failed: Pickup - ${pickupGeocode.error}, Delivery - ${deliveryGeocode.error}`);
            }

            // Calculate package volume for dimensional weight
            const dimensions = options.dimensions || { length: 10, width: 10, height: 10 };
            const volume = dimensions.length * dimensions.width * dimensions.height;
            const dimensionalWeight = volume / 5000; // Standard dimensional weight factor
            
            // Use the greater of actual weight or dimensional weight
            const billableWeight = Math.max(options.weight || 1, dimensionalWeight);

            // Enhanced amount calculation considering dimensions
            const enhancedAmount = this.calculateEnhancedAmount(
                pickupGeocode,
                deliveryGeocode,
                {
                    ...options,
                    weight: billableWeight,
                    dimensions: dimensions,
                    dimensionalWeight: dimensionalWeight
                }
            );

            const payload = {
                access_token: this.token,
                benefit_type: null,
                amount: enhancedAmount.toString(),
                insurance_amount: options.insurance_amount || 0,
                total_no_of_tasks: 1,
                pickup_time: new Date().toISOString().replace('T', ' ').substring(0, 19),
                user_id: this.userId,
                form_id: this.formId,
                promo_value: null,
                domain_name: process.env.KWIK_DOMAIN,
                credits: 0,
                total_service_charge: options.serviceCharge || 0,
                vehicle_id: options.vehicleId || this.determineEnhancedVehicleId(billableWeight, dimensions),
                delivery_images: options.images || '',
                is_loader_required: (options.loadersRequired || billableWeight > 10) ? 1 : 0,
                loaders_amount: options.loadersAmount || 0,
                loaders_count: options.loadersCount || (billableWeight > 10 ? 1 : 0),
                is_cod_job: options.isCOD ? 1 : 0,
                parcel_amount: options.parcel_amount || 0,
                delivery_charge_by_buyer: 0,
                delivery_instruction: options.instructions?.substring(0, 500) || '',
                // Enhanced package details
                package_weight: billableWeight,
                package_length: dimensions.length,
                package_width: dimensions.width,
                package_height: dimensions.height,
                item_count: options.itemCount || 1
            };

            const response = await this.client.post('/get_bill_breakdown', payload);

            if (response.data.status === 200) {
                return {
                    success: true,
                    fee: parseFloat(response.data.data.AMOUNT_PER_TASK),
                    breakdown: response.data.data,
                    package: {
                        weight: billableWeight,
                        dimensions: dimensions,
                        itemCount: options.itemCount || 1,
                        actualWeight: options.weight,
                        dimensionalWeight: dimensionalWeight
                    },
                    currency: 'NGN',
                    message: response.data.message
                };
            } else {
                throw new Error(response.data.message);
            }

        } catch (error) {
            console.error('[KWIK] Enhanced bill breakdown failed:', error.message);
            return {
                success: false,
                error: error.message,
                fallback: true
            };
        }
    }

    async getBillBreakdown(pickup, delivery, options = {}) {
        try {
            // Use enhanced calculation by default
            return await this.getEnhancedBillBreakdown(pickup, delivery, options);
        } catch (error) {
            console.error('[KWIK] Bill breakdown failed:', error.message);
            return {
                success: false,
                error: error.message,
                fallback: true
            };
        }
    }

    async geocodeWithFallback(address, providedLat, providedLng) {
        // Use provided coordinates if available and seem valid
        if (providedLat && providedLng &&
            Math.abs(providedLat) <= 90 && Math.abs(providedLng) <= 180) {
            return {
                success: true,
                latitude: providedLat,
                longitude: providedLng,
                accuracy: 'provided',
                source: 'client_provided'
            };
        }

        // Otherwise use basic fallback
        return {
            success: true,
            latitude: providedLat || 6.5244, // Default Lagos coordinates
            longitude: providedLng || 3.3792,
            accuracy: 'estimated',
            source: 'fallback'
        };
    }

    // Enhanced amount calculation with dimensions
    calculateEnhancedAmount(pickup, delivery, options = {}) {
        const distance = this.calculateDistance(
            pickup.latitude,
            pickup.longitude,
            delivery.latitude,
            delivery.longitude
        );

        // Base pricing algorithm
        let baseFare = this.getBaseFare(options.vehicleId);
        let distanceFare = distance * this.getDistanceRate(options.vehicleId);
        
        // Weight-based charges (using billable weight)
        let weightFare = options.weight * this.getWeightRate(options.vehicleId);
        
        // Dimension surcharge for bulky items
        const volume = options.dimensions.length * options.dimensions.width * options.dimensions.height;
        let dimensionSurcharge = 0;
        if (volume > 1000000) dimensionSurcharge = 400; // Large items
        else if (volume > 500000) dimensionSurcharge = 200; // Medium items
        else if (volume > 100000) dimensionSurcharge = 100; // Small bulky items

        let total = baseFare + distanceFare + weightFare + dimensionSurcharge;

        // Additional charges
        if (options.isInsured) total += total * 0.07;
        if (options.loadersRequired) total += (options.loadersCount || 0) * 250;
        if (options.isCOD) total += 150;
        if (options.serviceCharge) total += options.serviceCharge;

        return Math.max(Math.round(total), baseFare);
    }

    // Enhanced vehicle selection in KwikService
    determineEnhancedVehicleId(weight, dimensions) {
        const volume = dimensions.length * dimensions.width * dimensions.height;
        
        if (weight > 20 || volume > 1000000) return 3; // Large van
        if (weight > 10 || volume > 500000) return 2;  // Medium van
        if (weight > 5 || volume > 100000) return 1;   // Small van
        return 0; // Bike
    }

    getBaseFare(vehicleId) {
        const baseFares = { 0: 400, 1: 650, 2: 950, 3: 1400 };
        return baseFares[vehicleId] || 650;
    }

    getDistanceRate(vehicleId) {
        const rates = { 0: 50, 1: 75, 2: 100, 3: 125 };
        return rates[vehicleId] || 75;
    }

    getWeightRate(vehicleId) {
        const rates = { 0: 60, 1: 90, 2: 120, 3: 180 };
        return rates[vehicleId] || 90;
    }

    calculateDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    // ==================== TASK CREATION ====================

    async createDeliveryTask(deliveryData) {
        try {
            if (!this.isAuthenticated) {
                await this.authenticate();
            }

            const validationError = this.validateDeliveryData(deliveryData);
            if (validationError) {
                throw new Error(validationError);
            }

            const requestData = {
                domain_name: process.env.KWIK_DOMAIN,
                access_token: this.token,
                vendor_id: this.vendorId,
                is_multiple_tasks: 1,
                timezone: -330,
                has_pickup: 1,
                has_delivery: 1,
                layout_type: 0,
                auto_assignment: deliveryData.autoAssign ? 1 : 0,
                team_id: deliveryData.teamId || "",
                pickups: [{
                    address: deliveryData.pickup.address,
                    name: deliveryData.pickup.name,
                    latitude: deliveryData.pickup.latitude || 0,
                    longitude: deliveryData.pickup.longitude || 0,
                    time: deliveryData.pickup.time || new Date().toISOString().replace('T', ' ').substring(0, 19),
                    phone: deliveryData.pickup.phone,
                    email: deliveryData.pickup.email || ""
                }],
                deliveries: [{
                    address: deliveryData.delivery.address,
                    name: deliveryData.delivery.name,
                    latitude: deliveryData.delivery.latitude || 0,
                    longitude: deliveryData.delivery.longitude || 0,
                    time: deliveryData.delivery.time || new Date(Date.now() + 30 * 60000).toISOString().replace('T', ' ').substring(0, 19),
                    phone: deliveryData.delivery.phone,
                    email: deliveryData.delivery.email || "",
                    has_return_task: deliveryData.isReturnTask || false,
                    is_package_insured: deliveryData.isInsured ? 1 : 0,
                    hadVairablePayment: 1,
                    hadFixedPayment: 0
                }],
                insurance_amount: deliveryData.insuranceAmount || 0,
                total_no_of_tasks: 1,
                total_service_charge: deliveryData.serviceCharge || 0,
                payment_method: deliveryData.paymentMethod || 524288,
                amount: deliveryData.amount.toString(),
                vehicle_id: deliveryData.vehicleId || 1,
                is_loader_required: deliveryData.loadersRequired ? 1 : 0,
                loaders_count: deliveryData.loadersCount || 0,
                loaders_amount: deliveryData.loadersAmount || 0,
                delivery_instruction: deliveryData.instructions?.substring(0, 500) || "",
                delivery_images: deliveryData.images || "",
                is_cod_job: deliveryData.isCOD ? 1 : 0,
                // Enhanced package details
                package_weight: deliveryData.package?.weight || 1,
                package_length: deliveryData.package?.length || 10,
                package_width: deliveryData.package?.width || 10,
                package_height: deliveryData.package?.height || 10,
                item_count: deliveryData.package?.item_count || 1
            };

            console.log('[KWIK] Creating enhanced delivery task', {
                vendorId: this.vendorId,
                pickup: deliveryData.pickup.address?.substring(0, 50),
                delivery: deliveryData.delivery.address?.substring(0, 50),
                package: deliveryData.package
            });

            const response = await this.client.post('/v2/create_task_via_vendor', requestData);

            if (response.data.status === 200) {
                return {
                    success: true,
                    orderId: response.data.data?.unique_order_id,
                    vendor_id: this.vendorId,
                    trackingLinks: response.data.data,
                    jobDetails: response.data.data,
                    message: response.data.message
                };
            } else {
                throw new Error(`Kwik API error: ${response.data.message}`);
            }
        } catch (error) {
            console.error('[KWIK] Create delivery task failed:', error.message);
            return {
                success: false,
                error: this.sanitizeErrorMessage(error)
            };
        }
    }

    // ==================== VALIDATION METHODS ====================

    validateDeliveryData(deliveryData) {
        if (!deliveryData.pickup?.address) return 'Pickup address is required';
        if (!deliveryData.delivery?.address) return 'Delivery address is required';
        if (!deliveryData.pickup?.name) return 'Pickup name is required';
        if (!deliveryData.delivery?.name) return 'Delivery name is required';
        if (!deliveryData.pickup?.phone) return 'Pickup phone is required';
        if (!deliveryData.delivery?.phone) return 'Delivery phone is required';
        if (!deliveryData.amount || isNaN(deliveryData.amount)) return 'Valid amount is required';
        return null;
    }

    validateAddressFormat(address) {
        try {
            if (!address || typeof address !== 'string') {
                return { isValid: false, error: 'Address must be a string' };
            }
            if (address.length < 10) {
                return { isValid: false, error: 'Address too short' };
            }
            if (address.length > 500) {
                return { isValid: false, error: 'Address too long' };
            }
            const hasComma = address.includes(',');
            const hasNumbers = /\d/.test(address);
            if (!hasComma && !hasNumbers) {
                return { isValid: false, error: 'Address format appears invalid' };
            }
            return { isValid: true };
        } catch (error) {
            return { isValid: false, error: 'Address validation failed' };
        }
    }

    // ==================== UTILITY METHODS ====================

    sanitizeErrorMessage(error) {
        if (error.response) {
            return error.response.data?.message || `Server error: ${error.response.status}`;
        } else if (error.request) {
            return 'Network error: No response from Kwik API';
        } else {
            return error.message || 'Unknown error occurred';
        }
    }

    async healthCheck() {
        try {
            const authResult = await this.authenticate();
            if (!authResult.success) {
                return { healthy: false, error: 'Authentication failed' };
            }

            const vehicles = await this.getVehicleOptions();
            return {
                healthy: true,
                vendor_id: this.vendorId,
                authenticated: this.isAuthenticated,
                vehicles_available: vehicles.success,
                timestamp: new Date().toISOString()
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = new KwikService();