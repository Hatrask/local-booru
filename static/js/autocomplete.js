/**
 * autocomplete.js
 *
 * This file contains all the logic for two related features:
 * 1. A reusable tag autocomplete component that fetches suggestions from the API.
 * 2. A client-side saved search manager that uses localStorage to persist
 *    a user's "pinned" and "recent" search queries.
 *
 * The main exported function is `setupTagAutocomplete`, which can be configured
 * to provide only tag suggestions or a combination of tags and saved searches.
 */

// ==========================================================================
// 1. CONSTANTS
// ==========================================================================
const SAVED_SEARCHES_KEY = 'localBooru_savedSearches';
const MAX_RECENT_SEARCHES = 10;
const MAX_PINNED_IN_DROPDOWN = 10;


// ==========================================================================
// 2. SAVED SEARCH MANAGEMENT (localStorage Logic)
// ==========================================================================

/**
 * Retrieves and migrates the saved searches object from localStorage.
 * This includes a seamless, one-time migration for users with the old data format.
 * @returns {{pinned: {query: string, lastUsed: number}[], recent: string[]}}
 */
function getSearches() {
    const data = localStorage.getItem(SAVED_SEARCHES_KEY);
    let searches = data ? JSON.parse(data) : { pinned: [], recent: [] };

    // Data Migration: If a pinned item is a string, convert it to the new object structure.
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
 * @param {string} query The search query to add.
 */
function addRecentSearch(query) {
    if (!query || typeof query !== 'string' || query.trim() === '') return;
    const searches = getSearches();
    const cleanedQuery = query.trim();

    if (searches.pinned.some(p => p.query === cleanedQuery)) {
        return; // Do not add to recents if it's already pinned.
    }

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
        if (!searches.recent.includes(query)) {
            searches.recent.unshift(query);
        }
    }
    saveSearches(searches);
}

/**
 * Deletes a query from either the pinned or recent list.
 * @param {string} query The query to delete.
 */
function deleteSearch(query) {
    const searches = getSearches();
    searches.pinned = searches.pinned.filter(p => p.query !== query);
    searches.recent = searches.recent.filter(q => q !== query);
    saveSearches(searches);
}

/**
 * Updates the 'lastUsed' timestamp for a pinned search to mark it as recently used.
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

    // --- Component State ---
    let debounceTimeout;
    let selectedIndex = -1;

    // --- Core Logic ---

    /**
     * Analyzes the input's value to determine the current tag being typed for context-aware suggestions.
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
     * Fetches tag suggestions from the backend API.
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

            // Prevent race conditions by checking if the term is still the same.
            if (getAutocompleteContext(inputElement.value).term === term) {
                renderTagSuggestions(tags);
            }
        } catch (error) {
            console.error('Error fetching autocomplete suggestions:', error);
        }
    }

    // --- DOM Rendering ---

    /**
     * Renders the list of tag suggestions.
     * @param {string[]} tags An array of tag strings.
     */
    function renderTagSuggestions(tags) {
        if (!tags || tags.length === 0) {
            hideSuggestions();
            return;
        }
        suggestionsContainer.innerHTML = '';
        tags.forEach(tag => {
            const div = document.createElement('div');
            div.textContent = tag;
            div.dataset.action = 'select-tag';
            div.dataset.query = tag;
            suggestionsContainer.appendChild(div);
        });
        selectedIndex = -1;
        showSuggestions();
    }

    /**
     * Renders the saved and recent searches.
     */
    function renderSavedSearches() {
        const searches = getSearches();
        if (searches.pinned.length === 0 && searches.recent.length === 0) {
            hideSuggestions();
            return;
        }

        suggestionsContainer.innerHTML = '';
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
     * Executes the selection of a tag suggestion, running a custom callback or default behavior.
     * @param {string} selectedTag The tag string that was selected.
     */
    function selectTagSuggestion(selectedTag) {
        if (typeof onSelect === 'function') {
            onSelect(selectedTag);
        } else {
            const { prefix } = getAutocompleteContext(inputElement.value);
            inputElement.value = `${prefix}${selectedTag} `;
        }
        inputElement.focus();
        hideSuggestions();
    }

    /**
     * Updates the visual highlight on the currently selected suggestion for keyboard navigation.
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

    // --- Event Handlers ---

    /**
     * Handles the 'input' event with debouncing to prevent excessive API calls.
     */
    function handleInput() {
        if (inputElement.value.trim() === '') {
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

    // Use 'mousedown' to prevent the input's 'blur' event from firing first.
    suggestionsContainer.addEventListener('mousedown', handleSuggestionInteraction);

    // Hide suggestions if the user clicks anywhere else.
    document.addEventListener('click', (e) => {
        if (e.target !== inputElement && !suggestionsContainer.contains(e.target)) {
            hideSuggestions();
        }
    });
}