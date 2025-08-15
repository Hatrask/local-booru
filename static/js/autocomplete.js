/**
 * autocomplete.js
 *
 * This file contains the logic for a reusable tag autocomplete component
 * that attaches to an input field and fetches suggestions from the API.
 * It can also be configured to show saved and recent searches.
 *
 * It depends on:
 * - ui_helpers.js (for tag parsing, styling, and VALID_CATEGORIES constant)
 * - saved_searches_manager.js (for saved/recent search functionality)
 */

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
            // This function now comes from ui_helpers.js
            const tag = parseTag(rawTag);
            // This function now comes from ui_helpers.js
            const categoryClass = getTagCategoryClass(tag.category);

            // Add the 'data-tag' attribute specifically for the favorite tag to enable styling.
            // We also add the base 'tag-pill' class to ensure the favorite styles apply correctly.
            const dataAttribute = rawTag === 'metadata:favorite' ? `data-tag="metadata:favorite"` : '';
            div.innerHTML = `<span class="suggestion-tag-pill tag-pill ${categoryClass}" ${dataAttribute}>${rawTag}</span>`;

            div.dataset.action = 'select-tag';
            div.dataset.query = rawTag;
            suggestionsContainer.appendChild(div);
        });
        selectedIndex = -1;
        showSuggestions();
    }

    /**
     * Renders a list of valid categories for the user to start a tag with.
     */
    function renderCategorySuggestions() {
        // VALID_CATEGORIES is a global constant from ui_helpers.js
        suggestionsContainer.innerHTML = '';
        VALID_CATEGORIES.forEach(category => {
            const div = document.createElement('div');
            const categoryClass = getTagCategoryClass(category); // from ui_helpers.js

            // Create a color-coded pill for the category suggestion.
            div.innerHTML = `<span class="suggestion-tag-pill tag-pill ${categoryClass}">${category}</span>`;

            div.dataset.action = 'select-category';
            div.dataset.query = category;
            suggestionsContainer.appendChild(div);
        });
        selectedIndex = -1;
        showSuggestions();
    }
    
    /**
     * Renders the saved and recent searches in the suggestions dropdown.
     */
    function renderSavedSearches() {
        // All these functions now come from saved_searches_manager.js
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
            // Always add a comma and a space after selecting a tag to streamline adding the next one.
            const suffix = ', ';
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
        const value = inputElement.value;
    
        // If the input is completely empty, show initial suggestions (saved searches or categories).
        if (value.trim() === '') {
            if (showSavedSearches) {
                renderSavedSearches();
            } else {
                renderCategorySuggestions();
            }
            return;
        }
    
        // If the user just finished a tag with a comma, show category suggestions for the next tag.
        // We check the value trimmed of trailing whitespace.
        if (value.trimEnd().endsWith(',')) {
            renderCategorySuggestions();
            return;
        }
    
        const { term } = getAutocompleteContext(value);
    
        // If there's no term to search for (e.g., after "tag1 AND "), hide suggestions.
        // This won't run in the comma case because we returned early.
        if (term === '') {
            hideSuggestions();
            return;
        }
    
        // Otherwise, fetch tag suggestions based on the current term.
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
            case 'select-category':
                const { prefix } = getAutocompleteContext(inputElement.value);
                inputElement.value = `${prefix}${query}:`;
                inputElement.focus();
                hideSuggestions();
                break;
            case 'select-query':
                inputElement.value = query;
                addRecentSearch(query); // from saved_searches_manager.js
                hideSuggestions();
                break;
            case 'pin-query':
                pinSearch(query); // from saved_searches_manager.js
                renderSavedSearches();
                break;
            case 'unpin-query':
                unpinSearch(query); // from saved_searches_manager.js
                renderSavedSearches();
                break;
            case 'delete-search':
                deleteSearch(query); // from saved_searches_manager.js
                renderSavedSearches();
                break;
        }
    }

    // --- Initialization ---
    inputElement.addEventListener('input', handleInput);
    inputElement.addEventListener('keydown', handleKeydown);

    inputElement.addEventListener('focus', () => {
        if (inputElement.value.trim() === '') {
            if (showSavedSearches) {
                renderSavedSearches();
            } else {
                renderCategorySuggestions();
            }
        }
    });

    // Use 'mousedown' to prevent the input from losing focus before the click is registered.
    suggestionsContainer.addEventListener('mousedown', handleSuggestionInteraction);

    // Hide suggestions if the user clicks anywhere else on the page.
    document.addEventListener('click', (e) => {
        if (e.target !== inputElement && !suggestionsContainer.contains(e.target)) {
            hideSuggestions();
        }
    });
}