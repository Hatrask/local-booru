/**
 * index.js
 *
 * This file contains the client-side logic for the homepage (`index.html`).
 * It sets up the main search bar with autocomplete functionality and renders
 * the animated image counter in the footer.
 */
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. DOM ELEMENT REFERENCES ---
    const searchInput = document.getElementById('search-input');
    const searchForm = document.querySelector('.search-form-index');
    const suggestionsBox = document.querySelector('.suggestions'); // More robust than nextElementSibling
    const counterElement = document.getElementById('image-counter');
    const footerInfoElement = document.querySelector('footer p');

    // --- 2. CORE FUNCTIONS ---

    /**
     * Renders the animated image counter using individual digit images.
     * @param {number} count - The total number of images to display.
     */
    function displayImageCount(count) {
        if (!counterElement || isNaN(count)) return;

        counterElement.innerHTML = '';
        const countString = count.toString();
        
        for (const digit of countString) {
            const img = document.createElement('img');
            img.src = `/static/img/counter/image_${digit}.gif`;
            img.alt = digit;
            counterElement.appendChild(img);
        }
    }

    /**
     * Extracts the total image count from the footer text.
     * This avoids needing the template variable directly in the JS file.
     * @returns {number | null} The parsed image count, or null if not found.
     */
    function getImageCountFromDOM() {
        if (!footerInfoElement) return null;
        
        const footerText = footerInfoElement.textContent || '';
        const match = footerText.match(/Serving (\d+) images/);
        
        if (match && match[1]) {
            return parseInt(match[1], 10);
        }
        
        return null;
    }
            
    // --- 3. INITIALIZATION ---

    /**
     * Sets up the page by initializing the autocomplete, event listeners,
     * and the image counter.
     */
    function initialize() {
        // Functions are imported from autocomplete.js and saved_searches_manager.js
        setupTagAutocomplete(searchInput, suggestionsBox, { showSavedSearches: true });

        // Add an event listener to the form to save the query on submission.
        searchForm.addEventListener('submit', () => {
            const query = searchInput.value.trim();
            if (query) {
                addRecentSearch(query);
            }
        });

        // Get the image count from the DOM and display the animated counter.
        const imageCount = getImageCountFromDOM();
        if (imageCount !== null) {
            displayImageCount(imageCount);
        }
    }

    // --- 4. START THE APPLICATION ---
    initialize();
});