/**
 * saved_searches_manager.js
 *
 * This file contains all the logic for managing saved and recent searches.
 * It interacts directly with the browser's localStorage to persist user data
 * across sessions. It uses an in-memory cache to minimize direct access to
 * localStorage, improving performance.
 */

// ==========================================================================
// 1. CONSTANTS & STATE
// ==========================================================================
const SAVED_SEARCHES_KEY = 'localBooru_savedSearches';
const MAX_RECENT_SEARCHES = 10;
const MAX_PINNED_IN_DROPDOWN = 10; // Used by autocomplete UI, but related to this data.

/**
 * @type {{pinned: {query: string, lastUsed: number}[], recent: string[]} | null}
 * An in-memory cache of the searches object. It's lazily loaded to avoid
 * hitting localStorage on every single operation.
 */
let searchesCache = null;

// ==========================================================================
// 2. CORE CACHING & I/O FUNCTIONS
// ==========================================================================

/**
 * Retrieves the saved searches object, utilizing an in-memory cache.
 * If the cache is not populated, it reads from localStorage, performs a
 * one-time data migration if needed, and populates the cache.
 * @returns {{pinned: {query: string, lastUsed: number}[], recent: string[]}}
 */
function getSearches() {
    // If the cache is already populated, return it immediately.
    if (searchesCache) {
        return searchesCache;
    }

    const data = localStorage.getItem(SAVED_SEARCHES_KEY);
    let searches = data ? JSON.parse(data) : { pinned: [], recent: [] };

    // Populate the cache for subsequent calls.
    searchesCache = searches;
    return searchesCache;
}

/**
 * Persists the provided searches object to localStorage and updates the cache.
 * This is now the single point of writing to disk.
 * @param {{pinned: {query: string, lastUsed: number}[], recent: string[]}} searches
 */
function saveSearches(searches) {
    searchesCache = searches; // Ensure the cache is in sync with what's being saved.
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(searches));
}

// ==========================================================================
// 3. PUBLIC API FUNCTIONS
// ==========================================================================

/**
 * Adds a search query to the list of recent searches.
 * If the search is already pinned, its `lastUsed` timestamp is updated instead.
 * This function now performs a single read and a single write operation.
 * @param {string} query The search query to add.
 */
function addRecentSearch(query) {
    if (!query || typeof query !== 'string' || query.trim() === '') return;
    
    const searches = getSearches(); // Get data from cache
    const cleanedQuery = query.trim();

    const pinnedItem = searches.pinned.find(p => p.query === cleanedQuery);
    
    if (pinnedItem) {
        // If the search is pinned, just update its usage timestamp.
        pinnedItem.lastUsed = Date.now();
    } else {
        // Otherwise, add to recents, ensuring no duplicates and respecting the max limit.
        searches.recent = searches.recent.filter(q => q !== cleanedQuery);
        searches.recent.unshift(cleanedQuery);
        if (searches.recent.length > MAX_RECENT_SEARCHES) {
            searches.recent.pop();
        }
    }
    
    saveSearches(searches); // A single save operation at the end of the transaction.
}

/**
 * Moves a search query from the recent list to the pinned list.
 * @param {string} query The query to pin.
 */
function pinSearch(query) {
    const searches = getSearches();
    
    // Remove from recents if it exists there.
    searches.recent = searches.recent.filter(q => q !== query);
    
    // Add to pinned if it's not already there.
    if (!searches.pinned.some(p => p.query === query)) {
        searches.pinned.unshift({ query: query, lastUsed: Date.now() });
    }
    
    saveSearches(searches);
}

/**
 * Moves a search query from the pinned list back to the recent list.
 * @param {string} query The query to unpin.
 */
function unpinSearch(query) {
    const searches = getSearches();
    const pinnedItem = searches.pinned.find(p => p.query === query);

    if (pinnedItem) {
        searches.pinned = searches.pinned.filter(p => p.query !== query);
        // Add it back to recents if it's not already there.
        if (!searches.recent.includes(query)) {
            searches.recent.unshift(query);
        }
    }
    
    saveSearches(searches);
}

/**
 * Deletes a query from both the pinned and recent lists.
 * @param {string} query The query to delete.
 */
function deleteSearch(query) {
    const searches = getSearches();
    
    searches.pinned = searches.pinned.filter(p => p.query !== query);
    searches.recent = searches.recent.filter(q => q !== query);
    
    saveSearches(searches);
}