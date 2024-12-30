class CacheService {
    constructor() {
        this.CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
    }

    async set(key, data) {
        const cacheEntry = {
            data,
            timestamp: Date.now()
        };
        await chrome.storage.local.set({ [key]: cacheEntry });
    }

    async get(key) {
        const result = await chrome.storage.local.get(key);
        const cacheEntry = result[key];

        if (!cacheEntry) return null;
        if (Date.now() - cacheEntry.timestamp > this.CACHE_DURATION) {
            await chrome.storage.local.remove(key);
            return null;
        }

        return cacheEntry.data;
    }
}
