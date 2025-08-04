/**
 * local-booru - autocomplete.js
 * 
 * This script provides a reusable and intelligent autocomplete component for tag input fields.
 * It is designed to handle complex search queries containing operators and provides a
 * responsive UI with keyboard and mouse navigation.
 */

/**
 * Initializes the autocomplete functionality on a given input field.
 * @param {HTMLInputElement|HTMLTextAreaElement} inputElement The input field to attach to.
 * @param {HTMLDivElement} suggestionsContainer The div element to display suggestions in.
 */
function setupTagAutocomplete(inputElement, suggestionsContainer) {
    
    // --- State Management ---
    let debounceTimeout;
    let selectedIndex = -1; // -1 means no selection

    // --- Core Logic ---

    /**
     * Analyzes the input's value to determine the current tag being typed.
     * This is the "brains" of the component, allowing it to work within complex queries.
     * @param {string} fullQuery - The entire string from the input field.
     * @returns {{prefix: string, term: string}} An object containing the part of the query
     * before the current tag (prefix) and the current tag itself (term).
     */
    function getAutocompleteContext(fullQuery) {
        // This regex splits the string by any of the supported separators.
        // The separators are: comma, ' AND ', ' OR ', pipe, '(', or '-'
        const parts = fullQuery.split(/,|\sAND\s|\sOR\s|\||\(|-/i);
        
        // The term we need to autocomplete is the last part of the split string.
        const currentTerm = parts[parts.length - 1].trimStart();
        
        // The prefix is everything in the original query before the current term.
        const prefixLength = fullQuery.length - currentTerm.length;
        const prefix = fullQuery.substring(0, prefixLength);
        
        return { prefix: prefix, term: currentTerm.toLowerCase() };
    }

    /**
     * Fetches tag suggestions from the backend API.
     */
    async function fetchSuggestions() {
        const { term } = getAutocompleteContext(inputElement.value);

        if (!term) {
            hideSuggestions();
            return;
        }
        
        try {
            const response = await fetch(`/api/tags/autocomplete?q=${encodeURIComponent(term)}`);
            if (!response.ok) throw new Error('Network request failed');
            
            const tags = await response.json();

            // Crucial check to prevent race conditions:
            // Only render suggestions if the input hasn't changed since we started the fetch.
            const newContext = getAutocompleteContext(inputElement.value);
            if (newContext.term === term) {
                renderSuggestions(tags);
            }
        } catch (error) {
            console.error('Error fetching autocomplete suggestions:', error);
            suggestionsContainer.innerHTML = '<div>Error fetching tags.</div>';
            showSuggestions(); // Show the error message
        }
    }

    // --- DOM & UI ---

    /**
     * Renders the list of suggestions in the container.
     * @param {string[]} tags - An array of tag strings.
     */
    function renderSuggestions(tags) {
        if (!tags || tags.length === 0) {
            hideSuggestions();
            return;
        }

        suggestionsContainer.innerHTML = ''; // Clear previous suggestions
        tags.forEach(tag => {
            const div = document.createElement('div');
            div.textContent = tag;
            // Use data-* attribute for easy access in the event handler
            div.dataset.tag = tag; 
            suggestionsContainer.appendChild(div);
        });
        showSuggestions();
    }

    /**
     * Selects a suggestion and updates the input field's value.
     * @param {string} selectedTag - The tag string that was selected.
     */
    function selectSuggestion(selectedTag) {
        const { prefix } = getAutocompleteContext(inputElement.value);
        inputElement.value = `${prefix}${selectedTag} `; // Add a space for the next tag
        inputElement.focus();
        hideSuggestions();
    }
    
    /**
     * Updates the visual highlight on the currently selected suggestion.
     */
    function updateHighlight() {
        const items = suggestionsContainer.querySelectorAll('div');
        items.forEach((item, i) => {
            item.classList.toggle('highlight', i === selectedIndex);
        });
        // Ensure the highlighted item is visible if the list scrolls
        if (selectedIndex > -1 && items[selectedIndex]) {
            items[selectedIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    function showSuggestions() {
        suggestionsContainer.style.display = 'block';
    }

    function hideSuggestions() {
        suggestionsContainer.style.display = 'none';
        selectedIndex = -1;
    }

    // --- Event Handlers ---

    /**
     * Handles the 'input' event with debouncing to prevent excessive API calls.
     */
    function handleInput() {
        clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(fetchSuggestions, 300);
    }

    /**
     * Handles keyboard navigation (ArrowUp, ArrowDown, Enter, Escape).
     */
    function handleKeydown(e) {
        if (suggestionsContainer.style.display === 'none') return;
        
        const items = suggestionsContainer.querySelectorAll('div');
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
                if (selectedIndex > -1) {
                    e.preventDefault();
                    selectSuggestion(items[selectedIndex].textContent);
                }
                break;
            case 'Escape':
                e.preventDefault();
                hideSuggestions();
                break;
        }
    }
    
    /**
     * Handles clicks on a suggestion using event delegation.
     */
    function handleSuggestionClick(e) {
        // Check if a suggestion div was clicked
        if (e.target.dataset.tag) {
            e.preventDefault(); // Prevents the input from losing focus
            selectSuggestion(e.target.dataset.tag);
        }
    }

    // --- Initialization ---

    inputElement.addEventListener('input', handleInput);
    inputElement.addEventListener('keydown', handleKeydown);

    // Use 'mousedown' instead of 'click' to prevent the input's 'blur' event
    // from hiding the suggestions before the click can be registered.
    suggestionsContainer.addEventListener('mousedown', handleSuggestionClick);

    // Hide suggestions if the user clicks anywhere else on the page.
    document.addEventListener('click', (e) => {
        if (e.target !== inputElement && !suggestionsContainer.contains(e.target)) {
            hideSuggestions();
        }
    });
}