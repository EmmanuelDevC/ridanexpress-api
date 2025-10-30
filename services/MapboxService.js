const axios = require('axios');

class MapboxService {
    constructor() {
        this.accessToken = process.env.MAPBOX_ACCESS_TOKEN;
        this.baseURL = 'https://api.mapbox.com';
        this.cache = new Map();
        this.cacheTimeout = 30 * 60 * 1000; // 30 minutes cache
        this.rateLimitDelay = 1000; // 1 second between requests
        this.lastRequestTime = 0;

        if (!this.accessToken) {
            throw new Error('MAPBOX_ACCESS_TOKEN is required in environment variables');
        }
    }

    async makeRequest(url, params = {}) {
        // Rate limiting to respect Mapbox API limits
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequestTime;
        if (timeSinceLastRequest < this.rateLimitDelay) {
            await new Promise(resolve =>
                setTimeout(resolve, this.rateLimitDelay - timeSinceLastRequest)
            );
        }

        try {
            const response = await axios.get(url, {
                params: {
                    access_token: this.accessToken,
                    ...params
                },
                timeout: 10000 // 10 second timeout
            });

            this.lastRequestTime = Date.now();
            return response.data;
        } catch (error) {
            console.error('[MAPBOX] API request failed:', error.message);
            throw this.handleError(error);
        }
    }

    handleError(error) {
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;

            switch (status) {
                case 401:
                    return new Error('Mapbox authentication failed - check access token');
                case 403:
                    return new Error('Mapbox access forbidden');
                case 404:
                    return new Error('Mapbox resource not found');
                case 429:
                    return new Error('Mapbox rate limit exceeded');
                case 500:
                    return new Error('Mapbox internal server error');
                case 502:
                    return new Error('Mapbox bad gateway');
                default:
                    return new Error(data.message || `Mapbox API error: ${status}`);
            }
        } else if (error.request) {
            return new Error('Network error: Unable to reach Mapbox API');
        } else {
            return new Error(error.message);
        }
    }

    // ==================== CORE GEOCODING METHODS ====================

    async geocodeAddress(address) {
        if (!address) {
            return { success: false, error: 'Address is required' };
        }

        console.log(`[MAPBOX] Geocoding: "${address}"`);

        try {
            // Try multiple approaches to get the right coordinates
            const data = await this.makeRequest(
                `${this.baseURL}/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json`,
                {
                    country: 'NG',
                    types: 'address,place,postcode,neighborhood',
                    limit: 10, // Get more results
                    autocomplete: true,
                    language: 'en'
                }
            );

            if (!data.features || data.features.length === 0) {
                console.log(`[MAPBOX] No results for: "${address}"`);
                return this.fallbackGeocode(address);
            }

            // Log all results to see what Mapbox finds
            console.log(`[MAPBOX] Found ${data.features.length} results for "${address}":`);
            data.features.forEach((feature, index) => {
                console.log(`  ${index + 1}. "${feature.place_name}" - Relevance: ${feature.relevance}`);
            });

            // Find the best match that's actually in Lagos
            const bestFeature = this.findBestLagosMatch(data.features, address);

            if (bestFeature) {
                console.log(`[MAPBOX] Selected: "${bestFeature.place_name}" at ${bestFeature.center[1]}, ${bestFeature.center[0]}`);

                return {
                    success: true,
                    latitude: bestFeature.center[1],  // REAL COORDINATES
                    longitude: bestFeature.center[0], // REAL COORDINATES
                    formattedAddress: address,        // YOUR ORIGINAL TEXT
                    mapboxAddress: bestFeature.place_name, // What Mapbox thinks it is
                    relevance: bestFeature.relevance,
                    accuracy: this.determineAccuracy(bestFeature),
                    serviceable: true
                };
            } else {
                console.log(`[MAPBOX] No good match found for "${address}", using fallback`);
                return this.fallbackGeocode(address);
            }

        } catch (error) {
            console.error('[MAPBOX] Geocoding failed:', error);
            return this.fallbackGeocode(address);
        }
    }

    findBestLagosMatch(features, originalAddress) {
        const originalLower = originalAddress.toLowerCase();

        // Priority 1: Exact matches in Lagos
        const lagosMatches = features.filter(feature =>
            feature.place_name.toLowerCase().includes('lagos') &&
            feature.relevance > 0.6
        );

        if (lagosMatches.length > 0) {
            return lagosMatches[0]; // Return the first Lagos match
        }

        // Priority 2: Any match with good relevance
        const goodMatches = features.filter(feature => feature.relevance > 0.7);
        if (goodMatches.length > 0) {
            return goodMatches[0];
        }

        // Priority 3: Just return the first result
        return features[0];
    }

    fallbackGeocode(address) {
        // Use original address, don't change it
        const coordinates = this.getApproximateCoordinates(address);

        return {
            success: true,
            latitude: coordinates.lat,
            longitude: coordinates.lng,
            formattedAddress: address, // KEEP ORIGINAL ADDRESS
            accuracy: 'approximate',
            serviceable: true,
            provider: 'fallback'
        };
    }

    async reverseGeocode(latitude, longitude) {
        if (latitude === undefined || longitude === undefined) {
            return {
                success: false,
                error: 'Latitude and longitude are required'
            };
        }

        const cacheKey = `reverse_${latitude}_${longitude}`;
        const cached = this.getFromCache(cacheKey);
        if (cached) {
            return { ...cached, cached: true };
        }

        try {
            const data = await this.makeRequest(
                `${this.baseURL}/geocoding/v5/mapbox.places/${longitude},${latitude}.json`,
                {
                    types: 'address,place,postcode,neighborhood,locality',
                    limit: 5
                }
            );

            if (!data.features || data.features.length === 0) {
                return {
                    success: false,
                    error: 'No address found for these coordinates'
                };
            }

            const bestFeature = data.features[0];
            const result = {
                success: true,
                formattedAddress: bestFeature.place_name,
                latitude,
                longitude,
                relevance: bestFeature.relevance,
                accuracy: this.determineAccuracy(bestFeature),
                properties: bestFeature.properties,
                placeType: bestFeature.place_type[0]
            };

            this.setToCache(cacheKey, result);
            return result;

        } catch (error) {
            console.error('[MAPBOX] Reverse geocoding failed:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async batchGeocode(addresses) {
        if (!Array.isArray(addresses) || addresses.length === 0) {
            return {
                success: false,
                error: 'Addresses array is required'
            };
        }

        // Mapbox doesn't have true batch geocoding, so we process sequentially with delays
        const results = [];

        for (const address of addresses) {
            try {
                const result = await this.geocodeAddress(address);
                results.push({
                    originalAddress: address,
                    success: result.success,
                    data: result.success ? {
                        latitude: result.latitude,
                        longitude: result.longitude,
                        formattedAddress: result.formattedAddress,
                        accuracy: result.accuracy,
                        relevance: result.relevance
                    } : null,
                    error: result.error
                });

                // Respect rate limits
                await new Promise(resolve => setTimeout(resolve, 200));
            } catch (error) {
                results.push({
                    originalAddress: address,
                    success: false,
                    data: null,
                    error: error.message
                });
            }
        }

        return {
            success: true,
            results,
            total: addresses.length,
            successful: results.filter(r => r.success).length,
            failed: results.filter(r => !r.success).length
        };
    }

    // ==================== DISTANCE & ROUTING METHODS ====================

    async calculateDistanceMatrix(origins, destinations, profile = 'driving') {
        try {
            if (!Array.isArray(origins) || !Array.isArray(destinations)) {
                throw new Error('Origins and destinations must be arrays');
            }

            const allCoordinates = [...origins, ...destinations];
            const coordinatesString = allCoordinates.map(coord =>
                `${coord.longitude},${coord.latitude}`
            ).join(';');

            const data = await this.makeRequest(
                `${this.baseURL}/directions-matrix/v1/mapbox/${profile}/${coordinatesString}`,
                {
                    sources: Array.from({ length: origins.length }, (_, i) => i).join(';'),
                    destinations: Array.from({ length: destinations.length }, (_, i) =>
                        i + origins.length
                    ).join(';'),
                    annotations: 'distance,duration'
                }
            );

            return {
                success: true,
                distances: data.distances,
                durations: data.durations,
                sources: data.sources,
                destinations: data.destinations
            };

        } catch (error) {
            console.error('[MAPBOX] Distance matrix failed:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    async calculateRoute(origin, destination, profile = 'driving') {
        try {
            const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;

            const data = await this.makeRequest(
                `${this.baseURL}/directions/v5/mapbox/${profile}/${coordinates}`,
                {
                    geometries: 'geojson',
                    overview: 'full',
                    steps: true,
                    annotations: 'distance,duration',
                    language: 'en'
                }
            );

            if (!data.routes || data.routes.length === 0) {
                return {
                    success: false,
                    error: 'No route found between the specified locations'
                };
            }

            const route = data.routes[0];
            return {
                success: true,
                distance: route.distance, // meters
                duration: route.duration, // seconds
                geometry: route.geometry,
                legs: route.legs,
                weight: route.weight,
                weight_name: route.weight_name,
                waypoints: data.waypoints
            };

        } catch (error) {
            console.error('[MAPBOX] Route calculation failed:', error.message);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ==================== ADDRESS VALIDATION & SERVICEABILITY ====================

    async validateAddress(address) {
        const geocodeResult = await this.geocodeAddress(address);

        if (!geocodeResult.success) {
            return {
                valid: false,
                error: geocodeResult.error,
                serviceable: false
            };
        }

        // Check if address is serviceable (within Nigeria and has good accuracy)
        const serviceable = await this.isAddressServiceable(
            geocodeResult.latitude,
            geocodeResult.longitude,
            geocodeResult.accuracy
        );

        return {
            valid: true,
            address: geocodeResult.formattedAddress,
            coordinates: {
                latitude: geocodeResult.latitude,
                longitude: geocodeResult.longitude
            },
            accuracy: geocodeResult.accuracy,
            relevance: geocodeResult.relevance,
            serviceable,
            placeType: geocodeResult.placeType,
            note: this.getServiceabilityNote(serviceable, geocodeResult.accuracy)
        };
    }

    async isAddressServiceable(latitude, longitude, accuracy = 'medium') {
        try {
            // First, check if coordinates are within Nigeria
            const withinNigeria = await this.isWithinNigeria(latitude, longitude);
            if (!withinNigeria) {
                return false;
            }

            // Check accuracy level - only high/medium accuracy addresses are considered serviceable
            const sufficientAccuracy = ['high', 'medium', 'rooftop', 'point'].includes(accuracy);
            if (!sufficientAccuracy) {
                return false;
            }

            return true;

        } catch (error) {
            console.error('[MAPBOX] Serviceability check failed:', error);
            return false;
        }
    }

    async isWithinNigeria(latitude, longitude) {
        // Nigeria bounding box coordinates
        const nigeriaBounds = {
            north: 13.9,
            south: 4.0,
            east: 14.7,
            west: 2.7
        };

        return (
            latitude >= nigeriaBounds.south &&
            latitude <= nigeriaBounds.north &&
            longitude >= nigeriaBounds.west &&
            longitude <= nigeriaBounds.east
        );
    }

    // ==================== HELPER METHODS ====================

    findBestFeature(features, originalAddress) {
        // Prioritize features with higher relevance and better match types
        const scoredFeatures = features.map(feature => {
            let score = feature.relevance;

            // Boost score for exact address matches
            if (feature.place_type.includes('address')) {
                score += 0.3;
            }

            // Boost score for place matches
            if (feature.place_type.includes('place')) {
                score += 0.2;
            }

            // Check if the feature text matches the original address well
            const addressMatch = this.calculateAddressMatch(originalAddress, feature.place_name);
            score += addressMatch * 0.2;

            return { feature, score };
        });

        // Sort by score descending and return the best
        scoredFeatures.sort((a, b) => b.score - a.score);
        return scoredFeatures[0].feature;
    }


    calculateAddressMatch(original, found) {
        const originalWords = original.toLowerCase().split(/\s+/);
        const foundWords = found.toLowerCase().split(/\s+/);

        const matchingWords = originalWords.filter(word =>
            foundWords.some(foundWord => foundWord.includes(word) || word.includes(foundWord))
        );

        return matchingWords.length / originalWords.length;
    }

    determineAccuracy(feature) {
        const placeType = feature.place_type[0];
        const relevance = feature.relevance;

        // Mapbox accuracy indicators based on place type and relevance
        if (placeType === 'address' && relevance >= 0.9) {
            return 'rooftop';
        } else if (placeType === 'address' && relevance >= 0.7) {
            return 'point';
        } else if (['place', 'poi'].includes(placeType) && relevance >= 0.8) {
            return 'high';
        } else if (relevance >= 0.6) {
            return 'medium';
        } else if (relevance >= 0.4) {
            return 'low';
        } else {
            return 'very_low';
        }
    }

    getServiceabilityNote(serviceable, accuracy) {
        if (!serviceable) {
            return 'Address is outside service area or has insufficient accuracy';
        }

        switch (accuracy) {
            case 'rooftop':
            case 'point':
                return 'High precision address - ideal for delivery';
            case 'high':
                return 'Good address accuracy - suitable for delivery';
            case 'medium':
                return 'Moderate accuracy - may require additional instructions';
            default:
                return 'Basic address accuracy - verification recommended';
        }
    }

    estimateDeliveryTime(distanceMeters, profile = 'driving') {
        const distanceKm = distanceMeters / 1000;
        const baseTime = 45; // minutes for pickup and processing

        // Estimate travel time based on profile and Nigerian traffic conditions
        let speedKph;
        switch (profile) {
            case 'driving':
                speedKph = 25; // Conservative estimate for Nigerian city traffic
                break;
            case 'cycling':
                speedKph = 15;
                break;
            case 'walking':
                speedKph = 5;
                break;
            default:
                speedKph = 20;
        }

        const travelTimeMinutes = (distanceKm / speedKph) * 60;
        const trafficBuffer = travelTimeMinutes * 0.4; // 40% buffer for Nigerian traffic

        const totalMinutes = baseTime + travelTimeMinutes + trafficBuffer;

        return {
            minutes: Math.round(totalMinutes),
            hours: (totalMinutes / 60).toFixed(1),
            distance: `${distanceKm.toFixed(1)} km`,
            estimatedArrival: new Date(Date.now() + totalMinutes * 60000).toISOString(),
            note: 'Estimate includes traffic and processing time'
        };
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

    clearCache() {
        const previousSize = this.cache.size;
        this.cache.clear();
        return {
            cleared: true,
            previous_size: previousSize,
            current_size: 0,
            timestamp: new Date().toISOString()
        };
    }

    getCacheStats() {
        const now = Date.now();
        let validEntries = 0;
        let expiredEntries = 0;

        this.cache.forEach((value, key) => {
            if (now - value.timestamp < this.cacheTimeout) {
                validEntries++;
            } else {
                expiredEntries++;
            }
        });

        return {
            total_entries: this.cache.size,
            valid_entries: validEntries,
            expired_entries: expiredEntries,
            cache_timeout_minutes: this.cacheTimeout / 60000
        };
    }

    // ==================== HEALTH CHECK ====================

    async healthCheck() {
        try {
            // Test with a known Nigerian address
            const testResult = await this.geocodeAddress('Lagos, Nigeria');

            return {
                healthy: testResult.success,
                service: 'mapbox',
                timestamp: new Date().toISOString(),
                cache_size: this.cache.size,
                last_request: this.lastRequestTime ? new Date(this.lastRequestTime).toISOString() : null,
                test_result: testResult.success ?
                    `Geocoding test passed: ${testResult.formattedAddress}` :
                    `Geocoding test failed: ${testResult.error}`
            };
        } catch (error) {
            return {
                healthy: false,
                service: 'mapbox',
                error: error.message,
                timestamp: new Date().toISOString()
            };
        }
    }
}

module.exports = new MapboxService();