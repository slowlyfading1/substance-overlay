class SubstanceAPI {
    constructor(settings = {}) {
        this.settings = settings;
        this.cache = new Map();
        this.requestQueue = new Map();
        this.CACHE_DURATION = 1000 * 60 * 60; // 1 hour cache
        this.MAX_RETRIES = 3;
        this.RETRY_DELAY = 1000;

        this.API_ENDPOINTS = {
            PSYCHONAUT: 'https://api.psychonautwiki.org',
            TRIPSIT: 'https://tripbot.tripsit.me/api/tripsit/getAllDrugNames',
            TRIPSIT_ALL: 'https://tripbot.tripsit.me/api/tripsit/getAllDrugs',
            TRIPSIT_INFO: 'https://tripbot.tripsit.me/api/tripsit/getDrug'
        };

        // Initialize error tracking
        this.errorCounts = new Map();
        this.ERROR_THRESHOLD = 5;
        this.ERROR_RESET_INTERVAL = 1000 * 60 * 5; // 5 minutes
    }

    normalizeSubstanceName(name) {
        if (!name || typeof name !== 'string') return '';
        return name.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    setFromCache(key, value) {
        if (!key || !value) return;
        this.cache.set(key, {
            timestamp: Date.now(),
            value: value
        });
    }

    getFromCache(key) {
        if (!key) return null;
        const cached = this.cache.get(key);
        if (!cached) return null;
        
        if (Date.now() - cached.timestamp > this.CACHE_DURATION) {
            this.cache.delete(key);
            return null;
        }
        
        return cached.value;
    }

    trackError(endpoint) {
        const count = (this.errorCounts.get(endpoint) || 0) + 1;
        this.errorCounts.set(endpoint, count);

        if (count === 1) {
            // Start reset timer for this endpoint
            setTimeout(() => {
                this.errorCounts.delete(endpoint);
            }, this.ERROR_RESET_INTERVAL);
        }

        return count >= this.ERROR_THRESHOLD;
    }

    async fetchWithRetry(fetchFn, endpoint, retries = this.MAX_RETRIES, delay = this.RETRY_DELAY) {
        if (this.trackError(endpoint)) {
            throw new Error(`Too many errors for endpoint: ${endpoint}`);
        }

        let lastError;
        
        for (let i = 0; i < retries; i++) {
            try {
                const result = await fetchFn();
                // Reset error count on success
                this.errorCounts.delete(endpoint);
                return result;
            } catch (error) {
                lastError = error;
                if (i < retries - 1) {
                    await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i)));
                }
            }
        }
        
        throw new Error(`API request failed after ${retries} retries: ${lastError?.message || 'Unknown error'}`);
    }

    async makeGraphQLRequest(query, variables = {}) {
        if (!query) throw new Error('Query is required');
        const requestKey = JSON.stringify({ query, variables });
        
        if (this.requestQueue.has(requestKey)) {
            return this.requestQueue.get(requestKey);
        }

        const requestPromise = (async () => {
            try {
                const response = await this.fetchWithRetry(async () => {
                    const result = await chrome.runtime.sendMessage({
                        type: 'API_REQUEST',
                        url: this.API_ENDPOINTS.PSYCHONAUT,
                        options: {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'Accept': 'application/json'
                            },
                            body: JSON.stringify({ query, variables })
                        }
                    });

                    if (!result?.success) {
                        throw new Error('API request returned unsuccessful status');
                    }

                    return result.data?.data ? result.data : { data: result.data };
                }, 'psychonaut');

                return response;
            } catch (error) {
                console.error('GraphQL request failed:', error);
                return { data: { substances: [] } };
            } finally {
                this.requestQueue.delete(requestKey);
            }
        })();

        this.requestQueue.set(requestKey, requestPromise);
        return requestPromise;
    }

    async makeAPIRequest(url, options = {}) {
        if (!url) throw new Error('URL is required');
        const endpoint = new URL(url).hostname;

        return this.fetchWithRetry(async () => {
            const response = await fetch(url, {
                ...options,
                headers: {
                    'Accept': 'application/json',
                    ...options.headers
                }
            });

            if (!response.ok) {
                throw new Error(`API request failed with status ${response.status}`);
            }

            const data = await response.json();
            if (!data) throw new Error('Empty response received');
            return data;
        }, endpoint);
    }

    async getPsychonautWikiMatches(substanceNames) {
        if (!this.settings.enablePsychonautWiki || !Array.isArray(substanceNames)) return new Map();

        const results = new Map();
        const uncachedSubstances = [];

        // Check cache first
        for (const name of substanceNames) {
            if (!name) continue;
            const normalized = this.normalizeSubstanceName(name);
            if (!normalized) continue;

            const cached = this.getFromCache(`pw_${normalized}`);
            if (cached) {
                results.set(name, cached);
            } else {
                uncachedSubstances.push(normalized);
            }
        }

        if (uncachedSubstances.length === 0) return results;

        try {
            const query = `
                query getSubstances($names: [String!]!) {
                    substances(query: $names) {
                        name
                        commonNames
                        class { chemical psychoactive }
                        tolerance { full half zero }
                        roas { 
                            name 
                            dose { 
                                units 
                                threshold 
                                heavy 
                                common { min max } 
                            } 
                            duration { 
                                onset 
                                peak 
                                offset 
                                total 
                            } 
                        }
                        uncertainInteractions { name note }
                        unsafeInteractions { name note }
                        dangerousInteractions { name note }
                    }
                }
            `;

            const response = await this.makeGraphQLRequest(query, {
                names: uncachedSubstances
            });

            const substances = response?.data?.substances || [];
            
            for (const substance of substances) {
                if (!substance?.name) continue;
                const normalized = this.normalizeSubstanceName(substance.name);
                const data = {
                    name: substance.name,
                    commonNames: substance.commonNames || [],
                    class: substance.class || {},
                    tolerance: substance.tolerance || {},
                    roas: substance.roas || [],
                    interactions: {
                        uncertain: substance.uncertainInteractions || [],
                        unsafe: substance.unsafeInteractions || [],
                        dangerous: substance.dangerousInteractions || []
                    },
                    source: 'PsychonautWiki'
                };
                
                this.setFromCache(`pw_${normalized}`, data);
                
                // Match against original substance names
                for (const originalName of substanceNames) {
                    if (this.normalizeSubstanceName(originalName) === normalized) {
                        results.set(originalName, data);
                    }
                }
            }
        } catch (error) {
            console.error('Failed to fetch PsychonautWiki data:', error);
        }

        return results;
    }

    async getTripSitMatches(substanceNames) {
        if (!this.settings.enableTripSit || !Array.isArray(substanceNames)) return new Map();

        const results = new Map();
        const uncachedSubstances = [];

        // Check cache first
        for (const name of substanceNames) {
            if (!name) continue;
            const normalized = this.normalizeSubstanceName(name);
            if (!normalized) continue;

            const cached = this.getFromCache(`tripsit_${normalized}`);
            if (cached) {
                results.set(name, cached);
            } else {
                uncachedSubstances.push(name);
            }
        }

        if (uncachedSubstances.length === 0) return results;

        try {
            // First get all drugs to match against
            const allDrugsResponse = await this.makeAPIRequest(this.API_ENDPOINTS.TRIPSIT_ALL);
            const allDrugs = allDrugsResponse?.data?.data?.drugs;
            
            if (!allDrugs || typeof allDrugs !== 'object') {
                throw new Error('Invalid TripSit API response format');
            }

            // Match substance names against TripSit data
            const matchedNames = new Set();
            for (const substance of uncachedSubstances) {
                const normalized = this.normalizeSubstanceName(substance);
                
                // Search through the drugs object
                const match = Object.values(allDrugs).find(drug => 
                    drug && (
                        this.normalizeSubstanceName(drug.name) === normalized ||
                        (Array.isArray(drug.aliases) && drug.aliases.some(alias => 
                            this.normalizeSubstanceName(alias) === normalized
                        ))
                    )
                );

                if (match?.name) {
                    matchedNames.add(match.name);
                }
            }

            // Fetch detailed information for matched substances
            for (const matchedName of matchedNames) {
                try {
                    const response = await this.makeAPIRequest(
                        `${this.API_ENDPOINTS.TRIPSIT_INFO}?name=${encodeURIComponent(matchedName)}`
                    );

                    const drugInfo = response?.data?.data;
                    if (drugInfo) {
                        const data = {
                            name: drugInfo.name,
                            aliases: drugInfo.aliases || [],
                            properties: {
                                dosage: drugInfo.properties?.dosage || {},
                                duration: drugInfo.properties?.duration || {},
                                effects: drugInfo.properties?.effects || [],
                                warnings: drugInfo.properties?.warnings || [],
                                categories: drugInfo.properties?.categories || []
                            },
                            interactions: drugInfo.interactions || {},
                            source: 'TripSit'
                        };

                        const normalized = this.normalizeSubstanceName(matchedName);
                        this.setFromCache(`tripsit_${normalized}`, data);

                        // Match against original substance names
                        for (const originalName of substanceNames) {
                            if (this.normalizeSubstanceName(originalName) === normalized) {
                                results.set(originalName, data);
                            }
                        }
                    }
                } catch (error) {
                    console.warn(`Failed to fetch detailed TripSit data for ${matchedName}:`, error);
                }
            }
        } catch (error) {
            console.error('Failed to fetch TripSit data:', error);
        }

        return results;
    }
}

// Export the class
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SubstanceAPI;
} else {
    window.SubstanceAPI = SubstanceAPI;
}