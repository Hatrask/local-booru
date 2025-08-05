/**
 * Sets up an intelligent, reusable autocomplete component for tag input fields.
 * It is designed to handle complex search queries with operators and provides a
 * responsive UI with full keyboard and mouse navigation.
 *
 * @param {HTMLInputElement|HTMLTextAreaElement} inputElement The input or textarea to attach to.
 * @param {HTMLDivElement} suggestionsContainer The div element where suggestions will be displayed.
 * @param {Function} [onSelect] An optional callback that runs when a suggestion is selected.
 *                              It receives the selected tag name as its argument. If not provided,
 *                              a default behavior for search queries is used.
 */
function setupTagAutocomplete(inputElement, suggestionsContainer, onSelect) {
    
    // --- State Management ---
    let debounceTimeout;
    let selectedIndex = -1; // -1 means no item is highlighted.

    // --- Core Logic ---

    /**
     * Analyzes the input's value to determine the current tag being typed.
     * This allows the autocomplete to work within complex, multi-part queries.
     * @param {string} fullQuery - The entire string from the input field.
     * @returns {{prefix: string, term: string}} An object with the query part before the
     *          current term (prefix) and the current term itself.
     */
    function getAutocompleteContext(fullQuery) {
        // This regex finds the last "word" in a query, treating various operators as word breaks.
        const parts = fullQuery.split(/,|\sAND\s|\sOR\s|\||\(|-/i);
        const currentTerm = parts[parts.length - 1].trimStart();
        
        const prefixLength = fullQuery.length - currentTerm.length;
        const prefix = fullQuery.substring(0, prefixLength);
        
        return { prefix: prefix, term: currentTerm.toLowerCase() };
    }

    /**
     * Fetches tag suggestions from the backend API based on the current term.
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

            // Crucial check to prevent a race condition: Only render suggestions if the
            // input value hasn't changed since this fetch was initiated.
            const newContext = getAutocompleteContext(inputElement.value);
            if (newContext.term === term) {
                renderSuggestions(tags);
            }
        } catch (error) {
            console.error('Error fetching autocomplete suggestions:', error);
            suggestionsContainer.innerHTML = '<div>Error fetching tags.</div>';
            showSuggestions();
        }
    }

    // --- DOM & UI ---

    /**
     * Renders the list of suggestion strings into the suggestions container.
     * @param {string[]} tags - An array of tag strings.
     */
    function renderSuggestions(tags) {
        if (!tags || tags.length === 0) {
            hideSuggestions();
            return;
        }

        suggestionsContainer.innerHTML = '';
        tags.forEach(tag => {
            const div = document.createElement('div');
            div.textContent = tag;
            div.dataset.tag = tag; 
            suggestionsContainer.appendChild(div);
        });
        showSuggestions();
    }

    /**
     * Executes the selection logic, either running the custom callback or default behavior.
     * @param {string} selectedTag - The tag string that was selected.
     */
    function selectSuggestion(selectedTag) {
        if (typeof onSelect === 'function') {
            onSelect(selectedTag);
        } else {
            // Default behavior for standard search inputs.
            const { prefix } = getAutocompleteContext(inputElement.value);
            inputElement.value = `${prefix}${selectedTag} `; 
        }
        
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
     * Handles keyboard navigation (Up, Down, Enter, Tab, Escape).
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
        if (e.target.dataset.tag) {
            e.preventDefault();
            selectSuggestion(e.target.dataset.tag);
        }
    }

    // --- Initialization ---

    inputElement.addEventListener('input', handleInput);
    inputElement.addEventListener('keydown', handleKeydown);

    // Use 'mousedown' instead of 'click'. This prevents the input's 'blur' event
    // from hiding the suggestions before the click can be registered.
    suggestionsContainer.addEventListener('mousedown', handleSuggestionClick);

    // Hide suggestions if the user clicks anywhere else on the page.
    document.addEventListener('click', (e) => {
        if (e.target !== inputElement && !suggestionsContainer.contains(e.target)) {
            hideSuggestions();
        }
    });
}