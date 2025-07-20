const logger = require('../../../Core/logger');


class ApiHelper {
    constructor() {
        this.apiKeys = new Map();
        this.loadApiKeys();
    }

    loadApiKeys() {
        // Hardcoded API keys here directly
        this.apiKeys.set('neoxr', 'WgNupT');
        this.apiKeys.set('openai', 'your-openai-api-key');
        this.apiKeys.set('google', 'your-google-api-key');
    }

    getApiKey(service) {
        const key = this.apiKeys.get(service.toLowerCase());
        if (!key) {
            logger.warn(`⚠️ API key not found for service: ${service}`);
        }
        return key;
    }

    async makeApiRequest(url, options = {}) {
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                },
                ...options
            });

            if (!response.ok) {
                throw new Error(`API request failed: ${response.status} ${response.statusText}`);
            }

            return await response.json();
        } catch (error) {
            logger.error('API request failed:', error);
            throw error;
        }
    }

    async neoxrApi(endpoint, params = {}) {
        const apiKey = this.getApiKey('neoxr');
        if (!apiKey) {
            throw new Error('Neoxr API key not configured');
        }

        const baseUrl = 'https://api.neoxr.my.id/api';
        const queryParams = new URLSearchParams({
            ...params,
            apikey: apiKey
        });

        const url = `${baseUrl}${endpoint}?${queryParams}`;
        return await this.makeApiRequest(url);
    }

    static createGlobalApi() {
        const helper = new ApiHelper();
        return {
            neoxr: helper.neoxrApi.bind(helper)
        };
    }
}

// Create global Api object for compatibility with original plugins
global.Api = ApiHelper.createGlobalApi();

module.exports = new ApiHelper();
