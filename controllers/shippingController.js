const KwikService = require('../services/KwikService');
const { responseReturn } = require('../utiles/response');

class ShippingController {

    constructor() {
        this.cache = new Map();
        this.cacheTimeout = 5 * 60 * 1000;

        // Bind methods
        this.get_vehicle_options = this.get_vehicle_options.bind(this);
        this.get_loader_options = this.get_loader_options.bind(this);
        this.calculate_shipping = this.calculate_shipping.bind(this);
        this.calculate_single_shipping = this.calculate_single_shipping.bind(this);
        this.validate_address = this.validate_address.bind(this);
        this.get_service_availability = this.get_service_availability.bind(this);
        this.get_shipping_rates = this.get_shipping_rates.bind(this);
        this.health_check = this.health_check.bind(this);
        this.calculate_enhanced_shipping = this.calculate_enhanced_shipping.bind(this);
    }

    // ==================== VEHICLE & LOADER OPTIONS ====================

    async get_vehicle_options(req, res) {
        try {
            const { size } = req.query;
            const cacheKey = `vehicles_${size}`;

            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return responseReturn(res, 200, {
                    vehicles: cached,
                    cached: true,
                    message: 'Vehicle options retrieved from cache'
                });
            }

            const result = await KwikService.getVehicleOptions(parseInt(size) || 0);

            if (result.success) {
                this.setToCache(cacheKey, result.vehicles);
                responseReturn(res, 200, {
                    vehicles: result.vehicles,
                    message: result.message
                });
            } else {
                responseReturn(res, 400, {
                    error: result.error,
                    code: 'VEHICLES_FETCH_FAILED'
                });
            }
        } catch (error) {
            console.error('[SHIPPING] Get vehicle options failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'SERVER_ERROR'
            });
        }
    }

    async get_loader_options(req, res) {
        try {
            const cacheKey = 'loaders';

            const cached = this.getFromCache(cacheKey);
            if (cached) {
                return responseReturn(res, 200, {
                    loaders: cached.loaders,
                    is_enabled: cached.is_enabled,
                    cached: true,
                    message: 'Loader options retrieved from cache'
                });
            }

            const result = await KwikService.getLoaderOptions();

            if (result.success) {
                this.setToCache(cacheKey, {
                    loaders: result.loaders,
                    is_enabled: result.is_loaders_enabled
                });
                responseReturn(res, 200, {
                    loaders: result.loaders,
                    is_enabled: result.is_loaders_enabled,
                    message: result.message
                });
            } else {
                responseReturn(res, 400, {
                    error: result.error,
                    code: 'LOADERS_FETCH_FAILED'
                });
            }
        } catch (error) {
            console.error('[SHIPPING] Get loader options failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'SERVER_ERROR'
            });
        }
    }

    // ==================== ENHANCED SHIPPING CALCULATION ====================

    async calculate_enhanced_shipping(req, res) {
        try {
            const { sellers, products } = req.body;

            if (!sellers || !Array.isArray(sellers)) {
                return responseReturn(res, 400, {
                    error: 'Sellers array is required',
                    code: 'INVALID_REQUEST'
                });
            }

            const shippingBreakdown = [];
            let totalFee = 0;
            let hasFallback = false;

            for (const seller of sellers) {
                const { sellerId, pickup, delivery, options = {} } = seller;

                // Validate required fields
                if (!pickup?.address || !delivery?.address) {
                    shippingBreakdown.push({
                        sellerId,
                        error: 'Address is required for both pickup and delivery',
                        fee: 0,
                        fallback: true
                    });
                    const fallbackFee = this.calculateEnhancedFallbackFee(pickup, delivery, options.weight || 1, options.dimensions);
                    totalFee += fallbackFee;
                    hasFallback = true;
                    continue;
                }

                // Calculate package details from products if provided
                let packageWeight = options.weight || 1;
                let packageDimensions = options.dimensions || { length: 10, width: 10, height: 10 };
                let itemCount = options.itemCount || 1;
                
                // If products are provided, calculate actual package details
                if (products && products.length > 0) {
                    const sellerProducts = products.filter(p => p.sellerId === sellerId);
                    if (sellerProducts.length > 0) {
                        const calculatedPackage = this.calculatePackageDetailsFromProducts(sellerProducts);
                        packageWeight = calculatedPackage.weight;
                        packageDimensions = calculatedPackage.dimensions;
                        itemCount = calculatedPackage.itemCount;
                    }
                }

                let vehicleId = options.vehicleId || this.determineEnhancedVehicleId(packageWeight, packageDimensions);

                const enhancedPickup = {
                    ...pickup,
                    latitude: pickup.latitude || 0,
                    longitude: pickup.longitude || 0
                };

                const enhancedDelivery = {
                    ...delivery,
                    latitude: delivery.latitude || 0,
                    longitude: delivery.longitude || 0
                };

                // Enhanced shipping calculation with dimensions
                const result = await KwikService.getEnhancedBillBreakdown(
                    enhancedPickup,
                    enhancedDelivery,
                    {
                        vehicleId,
                        weight: packageWeight,
                        dimensions: packageDimensions,
                        itemCount: itemCount,
                        isInsured: options.isInsured || false,
                        loadersRequired: options.loadersRequired || false,
                        loadersCount: options.loadersCount || 0,
                        isCOD: options.isCOD || false,
                        parcel_amount: options.parcel_amount || 0,
                        instructions: options.instructions || '',
                        insurance_amount: options.insurance_amount || 0,
                        serviceCharge: options.serviceCharge || 0,
                        ...options
                    }
                );

                if (result.success) {
                    shippingBreakdown.push({
                        sellerId,
                        fee: parseFloat(result.fee),
                        vendor_id: result.vendor_id,
                        vehicleId,
                        package: result.package,
                        details: result.breakdown,
                        estimatedDeliveryTime: this.estimateDeliveryTime(enhancedPickup, enhancedDelivery),
                        currency: result.currency,
                        serviceable: true,
                        calculatedFrom: 'actual_products'
                    });
                    totalFee += parseFloat(result.fee) || 0;
                } else {
                    // Enhanced fallback calculation
                    shippingBreakdown.push({
                        sellerId,
                        error: result.error,
                        fee: 0,
                        fallback: true
                    });
                    const fallbackFee = this.calculateEnhancedFallbackFee(enhancedPickup, enhancedDelivery, packageWeight, packageDimensions);
                    totalFee += fallbackFee;
                    hasFallback = true;
                }
            }

            responseReturn(res, 200, {
                totalFee: totalFee.toFixed(2),
                breakdown: shippingBreakdown,
                currency: 'NGN',
                hasFallback,
                calculatedFrom: 'enhanced_with_products',
                note: hasFallback ? 'Some calculations used enhanced fallback pricing' : 'All calculations from enhanced Kwik API'
            });

        } catch (error) {
            console.error('[SHIPPING] Enhanced shipping calculation failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'ENHANCED_CALCULATION_FAILED'
            });
        }
    }

    // ==================== SHIPPING CALCULATION ====================

    async calculate_shipping(req, res) {
        try {
            const { sellers, products } = req.body;

            if (!sellers || !Array.isArray(sellers)) {
                return responseReturn(res, 400, {
                    error: 'Sellers array is required',
                    code: 'INVALID_REQUEST'
                });
            }

            const shippingBreakdown = [];
            let totalFee = 0;
            let hasFallback = false;

            for (const seller of sellers) {
                const { sellerId, pickup, delivery, options = {} } = seller;

                // Validate required fields
                if (!pickup?.address || !delivery?.address) {
                    shippingBreakdown.push({
                        sellerId,
                        error: 'Address is required for both pickup and delivery',
                        fee: 0,
                        fallback: true
                    });
                    const fallbackFee = this.calculateEnhancedFallbackFee(pickup, delivery, options.weight || 1, options.dimensions);
                    totalFee += fallbackFee;
                    hasFallback = true;
                    continue;
                }

                // Calculate package details from products if provided
                let packageWeight = options.weight || 1;
                let packageDimensions = options.dimensions || { length: 10, width: 10, height: 10 };
                
                if (products && products.length > 0) {
                    const sellerProducts = products.filter(p => p.sellerId === sellerId);
                    if (sellerProducts.length > 0) {
                        const calculatedPackage = this.calculatePackageDetailsFromProducts(sellerProducts);
                        packageWeight = calculatedPackage.weight;
                        packageDimensions = calculatedPackage.dimensions;
                    }
                }

                let vehicleId = options.vehicleId || this.determineEnhancedVehicleId(packageWeight, packageDimensions);

                const enhancedPickup = {
                    ...pickup,
                    latitude: pickup.latitude || 0,
                    longitude: pickup.longitude || 0
                };

                const enhancedDelivery = {
                    ...delivery,
                    latitude: delivery.latitude || 0,
                    longitude: delivery.longitude || 0
                };

                // Calculate shipping fee using enhanced Kwik service
                const result = await KwikService.getEnhancedBillBreakdown(
                    enhancedPickup,
                    enhancedDelivery,
                    {
                        vehicleId,
                        weight: packageWeight,
                        dimensions: packageDimensions,
                        itemCount: options.itemCount || 1,
                        isInsured: options.isInsured || false,
                        loadersRequired: options.loadersRequired || false,
                        loadersCount: options.loadersCount || 0,
                        isCOD: options.isCOD || false,
                        parcel_amount: options.parcel_amount || 0,
                        instructions: options.instructions || '',
                        insurance_amount: options.insurance_amount || 0,
                        serviceCharge: options.serviceCharge || 0,
                        ...options
                    }
                );

                if (result.success) {
                    shippingBreakdown.push({
                        sellerId,
                        fee: parseFloat(result.fee),
                        vendor_id: result.vendor_id,
                        vehicleId,
                        package: result.package,
                        details: result.breakdown,
                        estimatedDeliveryTime: this.estimateDeliveryTime(enhancedPickup, enhancedDelivery),
                        currency: result.currency,
                        serviceable: true
                    });
                    totalFee += parseFloat(result.fee) || 0;
                } else {
                    // Enhanced fallback calculation
                    shippingBreakdown.push({
                        sellerId,
                        error: result.error,
                        fee: 0,
                        fallback: true
                    });
                    const fallbackFee = this.calculateEnhancedFallbackFee(enhancedPickup, enhancedDelivery, packageWeight, packageDimensions);
                    totalFee += fallbackFee;
                    hasFallback = true;
                }
            }

            responseReturn(res, 200, {
                totalFee: totalFee.toFixed(2),
                breakdown: shippingBreakdown,
                currency: 'NGN',
                hasFallback,
                note: hasFallback ? 'Some calculations used enhanced fallback pricing' : 'All calculations from enhanced Kwik API'
            });

        } catch (error) {
            console.error('[SHIPPING] Calculate shipping failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'CALCULATION_FAILED'
            });
        }
    }

    async calculate_single_shipping(req, res) {
        try {
            const { pickup, delivery, options = {}, products = [] } = req.body;

            if (!pickup?.address || !delivery?.address) {
                return responseReturn(res, 400, {
                    error: 'Pickup and delivery addresses are required',
                    code: 'ADDRESS_REQUIRED'
                });
            }

            // Calculate package details from products if provided
            let packageWeight = options.weight || 1;
            let packageDimensions = options.dimensions || { length: 10, width: 10, height: 10 };
            let itemCount = options.itemCount || 1;
            
            if (products.length > 0) {
                const calculatedPackage = this.calculatePackageDetailsFromProducts(products);
                packageWeight = calculatedPackage.weight;
                packageDimensions = calculatedPackage.dimensions;
                itemCount = calculatedPackage.itemCount;
            }

            let vehicleId = options.vehicleId || this.determineEnhancedVehicleId(packageWeight, packageDimensions);

            const enhancedPickup = {
                ...pickup,
                latitude: pickup.latitude || 0,
                longitude: pickup.longitude || 0
            };

            const enhancedDelivery = {
                ...delivery,
                latitude: delivery.latitude || 0,
                longitude: delivery.longitude || 0
            };

            // Enhanced Kwik API call with dimensions
            const result = await KwikService.getEnhancedBillBreakdown(
                enhancedPickup,
                enhancedDelivery,
                {
                    vehicleId,
                    weight: packageWeight,
                    dimensions: packageDimensions,
                    itemCount: itemCount,
                    isInsured: options.isInsured || false,
                    loadersRequired: options.loadersRequired || false,
                    loadersCount: options.loadersCount || 0,
                    isCOD: options.isCOD || false,
                    parcel_amount: options.parcel_amount || 0,
                    instructions: options.instructions || '',
                    ...options
                }
            );

            const responseData = {
                fee: result.success ? parseFloat(result.fee) : this.calculateEnhancedFallbackFee(enhancedPickup, enhancedDelivery, packageWeight, packageDimensions),
                vendor_id: result.vendor_id,
                vehicleId,
                package: {
                    weight: packageWeight,
                    dimensions: packageDimensions,
                    itemCount: itemCount
                },
                details: result.breakdown,
                estimatedDeliveryTime: this.estimateDeliveryTime(enhancedPickup, enhancedDelivery),
                currency: result.currency || 'NGN',
                fallback: !result.success,
                calculatedFrom: products.length > 0 ? 'actual_products' : 'estimated',
                note: result.success ? 'Accurate calculation from enhanced Kwik service' : 'Using enhanced estimated fee',
                serviceable: true
            };

            responseReturn(res, 200, responseData);

        } catch (error) {
            console.error('[SHIPPING] Enhanced single shipping calculation failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'CALCULATION_FAILED'
            });
        }
    }

    // ==================== PACKAGE CALCULATION METHODS ====================

    calculatePackageDetailsFromProducts(products) {
        let totalWeight = 0;
        let maxLength = 0;
        let maxWidth = 0;
        let maxHeight = 0;
        let totalItems = 0;
        let totalVolume = 0;

        products.forEach(product => {
            const weight = product.weight || product.productInfo?.weight || 0.5;
            const length = product.length || product.productInfo?.length || 10;
            const width = product.width || product.productInfo?.width || 10;
            const height = product.height || product.productInfo?.height || 10;
            const quantity = product.quantity || 1;

            totalWeight += weight * quantity;
            maxLength = Math.max(maxLength, length);
            maxWidth = Math.max(maxWidth, width);
            maxHeight = Math.max(maxHeight, height);
            totalItems += quantity;
            totalVolume += length * width * height * quantity;
        });

        // Calculate dimensional weight (L*W*H/5000)
        const dimensionalWeight = totalVolume / 5000;

        return {
            weight: Math.max(totalWeight, dimensionalWeight),
            dimensions: {
                length: maxLength,
                width: maxWidth,
                height: maxHeight
            },
            actualWeight: totalWeight,
            dimensionalWeight: dimensionalWeight,
            itemCount: totalItems,
            volume: totalVolume
        };
    }

    // Enhanced vehicle selection
    determineEnhancedVehicleId(weight, dimensions) {
        const volume = dimensions.length * dimensions.width * dimensions.height;
        
        // Vehicle selection logic considering both weight and volume
        if (weight > 25 || volume > 1500000) return 3; // Large van
        if (weight > 15 || volume > 800000) return 2;  // Medium van
        if (weight > 5 || volume > 200000) return 1;   // Small van
        return 0; // Bike
    }

    // Enhanced fallback fee calculation
    calculateEnhancedFallbackFee(pickup, delivery, weight = 1, dimensions = { length: 10, width: 10, height: 10 }) {
        let baseFee = 750;

        if (pickup.latitude && pickup.longitude && delivery.latitude && delivery.longitude) {
            const distance = this.calculateDistance(
                parseFloat(pickup.latitude),
                parseFloat(pickup.longitude),
                parseFloat(delivery.latitude),
                parseFloat(delivery.longitude)
            );
            const distanceRate = Math.max(distance * 75, 250);
            baseFee += distanceRate;
        } else {
            baseFee += 400;
        }

        // Weight surcharge
        const weightSurcharge = (weight - 1) * 120;
        
        // Dimension surcharge for bulky items
        const volume = dimensions.length * dimensions.width * dimensions.height;
        let dimensionSurcharge = 0;
        if (volume > 1000000) dimensionSurcharge = 500; // > 1m³
        else if (volume > 500000) dimensionSurcharge = 300; // > 0.5m³
        else if (volume > 100000) dimensionSurcharge = 150; // > 0.1m³

        const totalFee = baseFee + weightSurcharge + dimensionSurcharge;

        return Math.max(totalFee, 750);
    }

    // ==================== ADDRESS VALIDATION ====================

    async validate_address(req, res) {
        try {
            const { address } = req.body;

            if (!address) {
                return responseReturn(res, 400, {
                    error: 'Address is required',
                    code: 'ADDRESS_REQUIRED'
                });
            }

            // Use validateAddressFormat for basic validation
            const formatValidation = KwikService.validateAddressFormat(address);

            if (!formatValidation.isValid) {
                return responseReturn(res, 200, {
                    valid: false,
                    error: formatValidation.error,
                    code: 'INVALID_FORMAT'
                });
            }

            // Check service availability
            const serviceable = await this.checkKwikServiceAvailability(address, address);

            responseReturn(res, 200, {
                valid: true,
                address: address,
                serviceable: serviceable,
                note: serviceable ? 'Address appears valid and serviceable' : 'Address may be outside service area',
                code: 'VALID_ADDRESS'
            });

        } catch (error) {
            console.error('[SHIPPING] Address validation failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'VALIDATION_ERROR'
            });
        }
    }

    async get_service_availability(req, res) {
        try {
            const { pickup, delivery } = req.query;

            if (!pickup || !delivery) {
                return responseReturn(res, 400, {
                    error: 'Pickup and delivery locations are required',
                    code: 'LOCATIONS_REQUIRED'
                });
            }

            const isAvailable = await this.checkKwikServiceAvailability(pickup, delivery);

            responseReturn(res, 200, {
                available: isAvailable,
                service: 'kwik',
                locations: {
                    pickup,
                    delivery
                },
                note: isAvailable ?
                    'Service available in Kwik supported areas' :
                    'Service may not be available in this area',
                code: isAvailable ? 'SERVICE_AVAILABLE' : 'SERVICE_UNAVAILABLE'
            });

        } catch (error) {
            console.error('[SHIPPING] Service availability check failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'AVAILABILITY_CHECK_FAILED'
            });
        }
    }

    async get_shipping_rates(req, res) {
        try {
            const { weight, distance, vehicleType, options = {}, dimensions = {} } = req.body;

            if (!weight || weight <= 0) {
                return responseReturn(res, 400, {
                    error: 'Valid weight is required',
                    code: 'WEIGHT_REQUIRED'
                });
            }

            const rates = this.calculateEnhancedShippingRates(weight, distance, vehicleType, dimensions, options);

            responseReturn(res, 200, {
                rates,
                currency: 'NGN',
                estimatedDelivery: this.estimateDeliveryByDistance(distance),
                note: 'These are enhanced estimated rates considering dimensions.',
                code: 'RATES_CALCULATED'
            });

        } catch (error) {
            console.error('[SHIPPING] Shipping rates calculation failed:', error);
            responseReturn(res, 500, {
                error: error.message,
                code: 'RATES_CALCULATION_FAILED'
            });
        }
    }

    // ==================== HELPER METHODS ====================

    estimateDeliveryTime(pickup, delivery) {
        if (pickup.latitude && pickup.longitude && delivery.latitude && delivery.longitude) {
            const distance = this.calculateDistance(
                parseFloat(pickup.latitude),
                parseFloat(pickup.longitude),
                parseFloat(delivery.latitude),
                parseFloat(delivery.longitude)
            );

            const estimatedMinutes = 45 + (distance * 3) + (distance * 0.1);

            return {
                minutes: Math.round(estimatedMinutes),
                hours: (estimatedMinutes / 60).toFixed(1),
                distance: distance.toFixed(1) + ' km',
                note: 'Actual delivery time may vary based on traffic and other factors'
            };
        }

        return {
            minutes: 60,
            hours: '1.0',
            distance: 'Unknown',
            note: 'Provide coordinates for more accurate estimation'
        };
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

    calculateEnhancedShippingRates(weight, distance, vehicleType = 'bike', dimensions = {}, options = {}) {
        const vehicleRates = {
            bike: { base: 400, perKm: 50, perKg: 60 },
            small: { base: 650, perKm: 75, perKg: 90 },
            medium: { base: 950, perKm: 100, perKg: 120 },
            large: { base: 1400, perKm: 125, perKg: 180 }
        };

        const rate = vehicleRates[vehicleType] || vehicleRates.bike;

        let total = rate.base;
        if (distance) total += (distance * rate.perKm);
        total += (weight * rate.perKg);

        // Dimension surcharge
        const volume = dimensions.length * dimensions.width * dimensions.height;
        if (volume > 1000000) total += 500;
        else if (volume > 500000) total += 300;
        else if (volume > 100000) total += 150;

        if (options.isInsured) total += total * 0.07;
        if (options.loadersCount > 0) total += options.loadersCount * 250;
        if (options.isCOD) total += 150;
        if (options.urgent) total += total * 0.2;

        return {
            base: rate.base,
            distanceCharge: distance ? (distance * rate.perKm) : 0,
            weightCharge: weight * rate.perKg,
            dimensionCharge: total - (rate.base + (distance ? (distance * rate.perKm) : 0) + (weight * rate.perKg)),
            total: Math.round(total),
            vehicleType,
            breakdown: {
                base_fare: rate.base,
                distance_fare: rate.perKm,
                weight_surcharge: rate.perKg,
                dimension_surcharge: volume > 100000 ? 'Yes' : 'No'
            }
        };
    }

    estimateDeliveryByDistance(distance) {
        if (!distance) {
            return {
                minutes: 60,
                hours: '1.0',
                note: 'Standard delivery time'
            };
        }

        const baseTime = 45;
        const timePerKm = 3;
        const trafficFactor = distance * 0.1;
        const totalMinutes = baseTime + (distance * timePerKm) + trafficFactor;

        return {
            minutes: Math.round(totalMinutes),
            hours: (totalMinutes / 60).toFixed(1),
            estimated_arrival: new Date(Date.now() + totalMinutes * 60000).toISOString()
        };
    }

    async checkKwikServiceAvailability(pickupLocation, deliveryLocation) {
        try {
            const supportedCities = [
                'lagos', 'abuja', 'port harcourt', 'ibadan', 'kano',
                'benin', 'enugu', 'kaduna', 'warri', 'uyo', 'calabar',
                'jos', 'owerri', 'aba', 'onitsha'
            ];

            const pickupCity = supportedCities.some(city =>
                pickupLocation.toLowerCase().includes(city)
            );

            const deliveryCity = supportedCities.some(city =>
                deliveryLocation.toLowerCase().includes(city)
            );

            return pickupCity && deliveryCity;
        } catch (error) {
            console.error('[SHIPPING] Service availability check failed:', error);
            return false;
        }
    }

    // ==================== CACHE MANAGEMENT ====================

    getFromCache(key) {
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
            return cached.data;
        }
        this.cache.delete(key);
        return null;
    }

    setToCache(key, data) {
        this.cache.set(key, {
            data,
            timestamp: Date.now()
        });
    }

    // ==================== HEALTH CHECK ====================

    async health_check(req, res) {
        try {
            const kwikHealth = await KwikService.healthCheck();

            responseReturn(res, 200, {
                service: 'shipping',
                healthy: kwikHealth.healthy,
                kwik_integration: kwikHealth,
                cache_size: this.cache.size,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[SHIPPING] Health check failed:', error);
            responseReturn(res, 500, {
                service: 'shipping',
                healthy: false,
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = new ShippingController();