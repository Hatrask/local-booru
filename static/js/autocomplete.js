/**
 * autocomplete.js
 *
 * This file contains the logic for two related features:
 * 1. A reusable tag autocomplete component that fetches suggestions from the API.
 * 2. A client-side saved search manager that uses localStorage to persist
 *    a user's "pinned" and "recent" search queries.
 *
 * The main exported function, `setupTagAutocomplete`, can be configured to provide
 * only tag suggestions or a combination of tags and saved searches.
 */

// ==========================================================================
// 1. CONSTANTS & HELPERS
// ==========================================================================
const SAVED_SEARCHES_KEY = 'localBooru_savedSearches';
const MAX_RECENT_SEARCHES = 10;
const MAX_PINNED_IN_DROPDOWN = 10;
const VALID_CATEGORIES = ["general", "artist", "character", "copyright", "metadata"];

/**
 * Parses a raw tag string (e.g., "artist:name") into its constituent parts.
 * @param {string} rawTag The raw tag string.
 * @returns {{name: string, category: string}} An object with the tag's name and category.
 */
function parseTag(rawTag) {
    if (rawTag.includes(':')) {
        const [category, name] = rawTag.split(':', 2);
        if (VALID_CATEGORIES.includes(category)) {
            return { name, category };
        }
    }
    // If no valid prefix is found, it defaults to the 'general' category.
    return { name: rawTag, category: 'general' };
}

/**
 * Returns the appropriate CSS class for a given tag category for color-coding.
 * @param {string} category The category of the tag.
 * @returns {string} The CSS class name.
 */
function getTagCategoryClass(category) {
    if (VALID_CATEGORIES.includes(category)) {
        return `tag-${category}`;
    }
    return 'tag-general';
}


// ==========================================================================
// 2. SAVED SEARCH MANAGEMENT (localStorage Logic)
// ==========================================================================

/**
 * Retrieves the saved searches object from localStorage.
 * Includes a one-time migration for users with an older data format.
 * @returns {{pinned: {query: string, lastUsed: number}[], recent: string[]}}
 */
function getSearches() {
    const data = localStorage.getItem(SAVED_SEARCHES_KEY);
    let searches = data ? JSON.parse(data) : { pinned: [], recent: [] };

    // ==========================================================================
    // ONE-TIME LOCALSTORAGE MIGRATION - TO BE REMOVED IN FUTURE VERSIONS
    // ==========================================================================
    // This block handles a client-side data migration for users who have an
    // older version of the saved searches data in localStorage.
    //
    // FOR FUTURE MAINTENANCE: This code can be safely removed after the beta phase.
    let migrationNeeded = false;
    searches.pinned = searches.pinned.map((item, index) => {
        if (typeof item === 'string') {
            migrationNeeded = true;
            return { query: item, lastUsed: Date.now() - index * 1000 };
        }
        return item;
    });

    if (migrationNeeded) {
        saveSearches(searches);
    }
    // ==========================================================================
    // END OF MIGRATION CODE
    // ==========================================================================

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


// ==========================================================================
// 3. AUTOCOMPLETE COMPONENT
// ==========================================================================

/**
 * Sets up an intelligent, reusable autocomplete component for text input fields.
 *
 * @param {HTMLInputElement|HTMLTextAreaElement} inputElement The input to attach to.
 * @param {HTMLDivElement} suggestionsContainer The div where suggestions will be displayed.
 * @param {object} [options={}] Optional configuration.
 * @param {Function} [options.onSelect] A custom callback for when a tag is selected.
 * @param {boolean} [options.showSavedSearches=false] If true, shows saved searches on focus.
 */
function setupTagAutocomplete(inputElement, suggestionsContainer, options = {}) {
    const { onSelect, showSavedSearches = false } = options;

    let debounceTimeout;
    let selectedIndex = -1;

    /**
     * Determines the current term being typed for context-aware suggestions.
     * It intelligently splits the input by various search operators.
     * @param {string} fullQuery The entire string from the input field.
     * @returns {{prefix: string, term: string}}
     */
    function getAutocompleteContext(fullQuery) {
        const parts = fullQuery.split(/,|\sAND\s|\sOR\s|\||\(|-/i);
        const currentTerm = parts[parts.length - 1].trimStart();
        const prefixLength = fullQuery.length - currentTerm.length;
        const prefix = fullQuery.substring(0, prefixLength);
        return { prefix, term: currentTerm.toLowerCase() };
    }

    /**
     * Fetches tag suggestions from the backend API based on the current term.
     */
    async function fetchTagSuggestions() {
        const { term } = getAutocompleteContext(inputElement.value);
        if (!term) {
            hideSuggestions();
            return;
        }
        try {
            const response = await fetch(`/api/tags/autocomplete?q=${encodeURIComponent(term)}`);
            if (!response.ok) throw new Error('Network request failed');
            const tags = await response.json();

            // Prevent race conditions by ensuring the term hasn't changed while fetching.
            if (getAutocompleteContext(inputElement.value).term === term) {
                renderTagSuggestions(tags);
            }
        } catch (error) {
            console.error('Error fetching autocomplete suggestions:', error);
        }
    }

    /**
     * Renders the list of tag suggestions as color-coded pills.
     * @param {string[]} tags An array of raw tag strings from the API.
     */
    function renderTagSuggestions(tags) {
        if (!tags || tags.length === 0) {
            hideSuggestions();
            return;
        }
        suggestionsContainer.innerHTML = '';
        tags.forEach(rawTag => {
            const div = document.createElement('div');
            const tag = parseTag(rawTag);
            const categoryClass = getTagCategoryClass(tag.category);

            div.innerHTML = `<span class="suggestion-tag-pill ${categoryClass}">${rawTag}</span>`;
            div.dataset.action = 'select-tag';
            div.dataset.query = rawTag;
            suggestionsContainer.appendChild(div);
        });
        selectedIndex = -1;
        showSuggestions();
    }

    /**
     * Renders the saved and recent searches in the suggestions dropdown.
     */
    function renderSavedSearches() {
        const searches = getSearches();
        if (searches.pinned.length === 0 && searches.recent.length === 0) {
            hideSuggestions();
            return;
        }

        suggestionsContainer.innerHTML = '';
        // Sort pinned searches by most recently used for relevance.
        const sortedPinned = [...searches.pinned].sort((a, b) => b.lastUsed - a.lastUsed);
        const pinnedToShow = sortedPinned.slice(0, MAX_PINNED_IN_DROPDOWN);
        let html = '';

        if (pinnedToShow.length > 0) {
            html += '<div class="suggestions-header">Pinned Searches</div>';
            pinnedToShow.forEach(item => {
                const q = item.query;
                html += `
                    <div class="suggestion-item-saved" data-action="select-query" data-query="${q}">
                        <span class="suggestion-text">${q}</span>
                        <div class="suggestion-controls">
                            <button title="Unpin Search" data-action="unpin-query" data-query="${q}">&#128279;</button>
                            <button title="Delete Search" data-action="delete-search" data-query="${q}">&#128465;</button>
                        </div>
                    </div>`;
            });
        }
        if (searches.recent.length > 0) {
            html += '<div class="suggestions-header">Recent Searches</div>';
            searches.recent.forEach(q => {
                html += `
                    <div class="suggestion-item-saved" data-action="select-query" data-query="${q}">
                        <span class="suggestion-text">${q}</span>
                        <div class="suggestion-controls">
                            <button title="Pin Search" data-action="pin-query" data-query="${q}">&#128204;</button>
                            <button title="Delete Search" data-action="delete-search" data-query="${q}">&#128465;</button>
                        </div>
                    </div>`;
            });
        }

        suggestionsContainer.innerHTML = html;
        selectedIndex = -1;
        showSuggestions();
    }

    /**
     * Handles the selection of a tag, either via custom callback or default behavior.
     * @param {string} selectedTag The tag string that was selected.
     */
    function selectTagSuggestion(selectedTag) {
        if (typeof onSelect === 'function') {
            onSelect(selectedTag);
        } else {
            const { prefix } = getAutocompleteContext(inputElement.value);
            const suffix = inputElement.tagName === 'TEXTAREA' ? ', ' : ' ';
            inputElement.value = `${prefix}${selectedTag}${suffix}`;
        }
        inputElement.focus();
        hideSuggestions();
    }

    /**
     * Updates the visual highlight for keyboard navigation.
     */
    function updateHighlight() {
        const items = Array.from(suggestionsContainer.children).filter(child => !child.classList.contains('suggestions-header'));
        items.forEach((item, i) => item.classList.toggle('highlight', i === selectedIndex));
        if (selectedIndex > -1 && items[selectedIndex]) {
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    function showSuggestions() { suggestionsContainer.style.display = 'block'; }
    function hideSuggestions() { suggestionsContainer.style.display = 'none'; selectedIndex = -1; }

    /**
     * Handles the 'input' event with debouncing to prevent excessive API calls.
     */
    function handleInput() {
        const { term } = getAutocompleteContext(inputElement.value);
        if (term === '' && inputElement.value.trim() !== '') {
            hideSuggestions();
            return;
        }
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(fetchTagSuggestions, 250);
    }

    /**
     * Handles keyboard navigation (Up, Down, Enter, Tab, Escape).
     */
    function handleKeydown(e) {
        if (suggestionsContainer.style.display === 'none') return;
        const items = Array.from(suggestionsContainer.children).filter(child => !child.classList.contains('suggestions-header'));
        if (items.length === 0) return;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                selectedIndex = (selectedIndex + 1) % items.length;
                updateHighlight();
                break;
            case 'ArrowUp':
                e.preventDefault();
                selectedIndex = (selectedIndex - 1 + items.length) % items.length;
                updateHighlight();
                break;
            case 'Enter':
            case 'Tab':
                if (selectedIndex > -1 && items[selectedIndex]) {
                    e.preventDefault();
                    handleSuggestionInteraction({ target: items[selectedIndex], preventDefault: () => {}, stopPropagation: () => {} });
                }
                break;
            case 'Escape':
                e.preventDefault();
                hideSuggestions();
                break;
        }
    }

    /**
     * Handles all clicks/mousedown events on any suggestion item or its controls.
     */
    function handleSuggestionInteraction(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        e.preventDefault();
        e.stopPropagation();

        const action = target.dataset.action;
        const query = target.dataset.query;

        switch (action) {
            case 'select-tag':
                selectTagSuggestion(query);
                break;
            case 'select-query':
                inputElement.value = query;
                touchPinnedSearch(query);
                hideSuggestions();
                break;
            case 'pin-query':
                pinSearch(query);
                renderSavedSearches();
                break;
            case 'unpin-query':
                unpinSearch(query);
                renderSavedSearches();
                break;
            case 'delete-search':
                deleteSearch(query);
                renderSavedSearches();
                break;
        }
    }

    // --- Initialization ---

    inputElement.addEventListener('input', handleInput);
    inputElement.addEventListener('keydown', handleKeydown);

    if (showSavedSearches) {
        inputElement.addEventListener('focus', () => {
            if (inputElement.value.trim() === '') {
                renderSavedSearches();
            }
        });
    }

    // Use 'mousedown' to prevent the input from losing focus before the click is registered.
    suggestionsContainer.addEventListener('mousedown', handleSuggestionInteraction);

    // Hide suggestions if the user clicks anywhere else on the page.
    document.addEventListener('click', (e) => {
        if (e.target !== inputElement && !suggestionsContainer.contains(e.target)) {
            hideSuggestions();
        }
    });
}
