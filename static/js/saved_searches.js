/**
 * saved_searches.js
 *
 * This file manages the client-side logic for the saved searches management
 * page (`saved_searches.html`). It reads pinned and recent searches from
 * localStorage (via the `saved_searches_manager.js` module) and renders them
 * into lists, providing controls to pin, unpin, and delete searches.
 */
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. DOM ELEMENT REFERENCES ---
    const pinnedList = document.getElementById('pinned-list');
    const recentList = document.getElementById('recent-list');
    const pinnedCountSpan = document.getElementById('pinned-count');
    const recentCountSpan = document.getElementById('recent-count');
    const clearPinnedBtn = document.getElementById('clear-pinned-btn');
    const clearRecentBtn = document.getElementById('clear-recent-btn');

    // --- 2. CORE RENDERING LOGIC ---

    /**
     * The main function to read from localStorage and redraw both lists on the page.
     * This function is the single source of truth for the UI.
     */
    function renderAllLists() {
        // Functions like getSearches() are imported from saved_searches_manager.js
        const searches = getSearches();

        // Sort pinned searches alphabetically for easier management on this page.
        searches.pinned.sort((a, b) => a.query.localeCompare(b.query));

        // Update counts and visibility of clear buttons.
        pinnedCountSpan.textContent = searches.pinned.length;
        recentCountSpan.textContent = searches.recent.length;
        clearPinnedBtn.style.display = searches.pinned.length > 0 ? 'inline-block' : 'none';
        clearRecentBtn.style.display = searches.recent.length > 0 ? 'inline-block' : 'none';

        // Render the contents of each list.
        renderList(pinnedList, searches.pinned.map(p => p.query), true);
        renderList(recentList, searches.recent, false);
    }

    /**
     * A helper function that populates a specific <ul> with search items.
     * @param {HTMLUListElement} ulElement - The list element to populate.
     * @param {Array<string>} queryList - The array of search query strings.
     * @param {boolean} isPinned - A flag to determine which control buttons to show.
     */
    function renderList(ulElement, queryList, isPinned) {
        ulElement.innerHTML = '';
        if (queryList.length === 0) {
            ulElement.innerHTML = '<li class="search-item" style="justify-content: center; color: var(--color-text-secondary);">No searches here.</li>';
            return;
        }

        queryList.forEach(query => {
            const li = document.createElement('li');
            li.className = 'search-item';
            
            const pinButtonHTML = isPinned
                ? `<button title="Unpin Search" data-action="unpin" data-query="${query}">&#128279;</button>` // Link symbol
                : `<button title="Pin Search" data-action="pin" data-query="${query}">&#128204;</button>`; // Pushpin symbol
            
            li.innerHTML = `
                <a href="/gallery?q=${encodeURIComponent(query)}" class="search-item-query">${query}</a>
                <div class="search-item-controls">
                    ${pinButtonHTML}
                    <button title="Delete Search" data-action="delete" data-query="${query}">&#128465;</button>
                </div>
            `;
            ulElement.appendChild(li);
        });
    }

    // --- 3. EVENT HANDLERS ---

    /**
     * Handles all clicks within the search lists using event delegation.
     * @param {MouseEvent} e - The click event.
     */
    function handleListInteraction(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        e.preventDefault();
        const action = target.dataset.action;
        const query = target.dataset.query;

        switch(action) {
            case 'pin': pinSearch(query); break;
            case 'unpin': unpinSearch(query); break;
            case 'delete':
                // Use a standard confirmation dialog for this action
                if (confirm(`Are you sure you want to delete the search "${query}"?`)) {
                    deleteSearch(query);
                }
                break;
        }
        // After any action, always re-render to reflect the change.
        renderAllLists();
    }

    /**
     * Sets up the application by attaching all necessary event listeners.
     */
    function initialize() {
        clearPinnedBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to delete ALL pinned searches? This cannot be undone.')) {
                const searches = getSearches();
                searches.pinned = [];
                saveSearches(searches);
                renderAllLists();
                if (typeof showToast === 'function') showToast('All pinned searches cleared.', 'success');
            }
        });

        clearRecentBtn.addEventListener('click', () => {
            if (confirm('Are you sure you want to clear ALL recent searches?')) {
                const searches = getSearches();
                searches.recent = [];
                saveSearches(searches);
                renderAllLists();
                if (typeof showToast === 'function') showToast('All recent searches cleared.', 'success');
            }
        });

        // Use event delegation for interactions within both lists
        pinnedList.addEventListener('click', handleListInteraction);
        recentList.addEventListener('click', handleListInteraction);

        // Perform the initial render on page load.
        renderAllLists();
    }
    
    // --- 4. START THE APPLICATION ---
    initialize();
});