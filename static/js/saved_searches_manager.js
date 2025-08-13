/**
 * saved_searches_manager.js
 *
 * This file contains all the logic for managing saved and recent searches.
 * It interacts directly with the browser's localStorage to persist user data
 * across sessions. It has no UI component and only exposes data management functions.
 */

// ==========================================================================
// 1. CONSTANTS
// ==========================================================================
const SAVED_SEARCHES_KEY = 'localBooru_savedSearches';
const MAX_RECENT_SEARCHES = 10;
const MAX_PINNED_IN_DROPDOWN = 10; // Used by autocomplete UI, but related to this data.

// ==========================================================================
// 2. CORE FUNCTIONS
// ==========================================================================

/**
 * Retrieves the saved searches object from localStorage.
 * Includes a one-time migration for users with an older data format.
 * @returns {{pinned: {query: string, lastUsed: number}[], recent: string[]}}
 */
function getSearches() {
    const data = localStorage.getItem(SAVED_SEARCHES_KEY);
    let searches = data ? JSON.parse(data) : { pinned: [], recent: [] };

    // ONE-TIME MIGRATION: Handles moving from a simple string array to an object array
    // for pinned searches. This can be removed in a future version.
    if (searches.pinned.length > 0 && typeof searches.pinned[0] === 'string') {
        searches.pinned = searches.pinned.map((item, index) => ({
             query: item,
             lastUsed: Date.now() - index * 1000 // Assign a staggered timestamp
        }));
        saveSearches(searches); // Save the migrated format
    }

    return searches;
}

/**
 * Persists the searches object to localStorage.
 * @param {{pinned: {query: string, lastUsed: number}[], recent: string[]}} searches
 */
function saveSearches(searches) {
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(searches));
}

/**
 * Adds a search query to the list of recent searches.
 * If the search is already pinned, its `lastUsed` timestamp is updated instead.
 * @param {string} query The search query to add.
 */
function addRecentSearch(query) {
    if (!query || typeof query !== 'string' || query.trim() === '') return;
    const searches = getSearches();
    const cleanedQuery = query.trim();

    // If the search is pinned, just update its usage timestamp.
    const pinnedItem = searches.pinned.find(p => p.query === cleanedQuery);
    if (pinnedItem) {
        touchPinnedSearch(cleanedQuery);
        return;
    }

    // Add to recents, ensuring no duplicates and respecting the max limit.
    searches.recent = searches.recent.filter(q => q !== cleanedQuery);
    searches.recent.unshift(cleanedQuery);
    if (searches.recent.length > MAX_RECENT_SEARCHES) {
        searches.recent.pop();
    }
    saveSearches(searches);
}

/**
 * Moves a search query from the recent list to the pinned list.
 * @param {string} query The query to pin.
 */
function pinSearch(query) {
    const searches = getSearches();
    searches.recent = searches.recent.filter(q => q !== query);
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

/**
 * Updates the 'lastUsed' timestamp for a pinned search.
 * This is called when a pinned search is used, to bump its relevance.
 * @param {string} query The query that was used.
 */
function touchPinnedSearch(query) {
    const searches = getSearches();
    const pinnedItem = searches.pinned.find(p => p.query === query);
    if (pinnedItem) {
        pinnedItem.lastUsed = Date.now();
        saveSearches(searches);
    }
}