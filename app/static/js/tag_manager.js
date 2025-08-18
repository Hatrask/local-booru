/**
 * tag_manager.js
 *
 * This file contains the client-side logic for the refactored, search-first
 * tag management page (`tag_manager.html`). It handles the Action Panel for
 * performing tag operations and a paginated "Tag Explorer" to find tags.
 */
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. DOM ELEMENT REFERENCES ---
    const actionSelect = document.getElementById('action-select');
    const actionForms = document.getElementById('action-forms');

    // Action Panel Forms & Inputs
    const forms = {
        rename: document.getElementById('form-rename'),
        changeCategory: document.getElementById('form-change-category'),
        merge: document.getElementById('form-merge'),
        delete: document.getElementById('form-delete')
    };

    const inputs = {
        renameTag: document.getElementById('rename-tag-input'),
        renameTagId: document.getElementById('rename-tag-id'),
        renameNewName: document.getElementById('rename-new-name-input'),
        categoryTag: document.getElementById('category-tag-input'),
        categoryTagId: document.getElementById('category-tag-id'),
        categoryNewCategory: document.getElementById('category-new-category-select'),
        mergeDeleteTag: document.getElementById('merge-delete-tag-input'),
        mergeDeleteTagId: document.getElementById('merge-delete-tag-id'),
        mergeKeepTag: document.getElementById('merge-keep-tag-input'),
        mergeKeepTagId: document.getElementById('merge-keep-tag-id'),
        deleteTag: document.getElementById('delete-tag-input'),
        deleteTagId: document.getElementById('delete-tag-id'),
    };

    // Action Panel Buttons
    const buttons = {
        rename: document.getElementById('rename-submit-btn'),
        changeCategory: document.getElementById('category-submit-btn'),
        merge: document.getElementById('merge-submit-btn'),
        delete: document.getElementById('delete-submit-btn'),
        deleteAllOrphans: document.getElementById('delete-all-orphans-btn'),
    };

    // Tag Explorer Elements
    const explorer = {
        searchInput: document.getElementById('explorer-search-input'),
        showOrphansOnly: document.getElementById('explorer-show-orphans-only'),
        sortSelect: document.getElementById('explorer-sort-select'),
        loadingMessage: document.getElementById('loading-message'),
        tagList: document.getElementById('explorer-tag-list'),
        pagination: document.getElementById('explorer-pagination'),
    };
    const explorerTagCountSpan = document.getElementById('explorer-tag-count');

    // --- 2. STATE MANAGEMENT ---
    let explorerState = {
        currentPage: 1,
        query: '',
        showOrphans: false,
        sortBy: 'name'
    };
    
    // --- 3. CORE FUNCTIONS ---

    /**
     * Switches the visible form in the Action Panel based on the dropdown selection.
     */
    function switchActionForm() {
        const selectedAction = actionSelect.value;
        // Hide all forms first
        for (const key in forms) {
            forms[key].classList.add('hidden');
        }
        // Show the selected form
        const formKeyMap = {
            'rename': 'rename',
            'change-category': 'changeCategory',
            'merge': 'merge',
            'delete': 'delete'
        };
        const formToShow = forms[formKeyMap[selectedAction]];
        if (formToShow) {
            formToShow.classList.remove('hidden');
        }
    }

    /**
     * Fetches tags for the Tag Explorer based on the current state.
     */
    async function fetchExplorerTags() {
        explorer.loadingMessage.classList.remove('hidden');
        explorer.tagList.innerHTML = '';
        explorer.pagination.innerHTML = '';

        const params = new URLSearchParams({
            q: explorerState.query,
            orphans_only: explorerState.showOrphans,
            sort_by: explorerState.sortBy,
            page: explorerState.currentPage,
            limit: 50
        });
        
        try {
            const response = await fetch(`/api/tags/search?${params.toString()}`);
            if (!response.ok) throw new Error('Network response was not ok.');
            
            const data = await response.json();
            explorerTagCountSpan.textContent = data.total.toLocaleString();
            renderExplorerList(data.tags);
            renderPagination(data);
        } catch (err) {
            console.error('Error fetching tags for explorer:', err);
            explorer.tagList.innerHTML = '<li class="tag-item" style="text-align: center; color: var(--color-danger);">Error loading tags.</li>';
        } finally {
            explorer.loadingMessage.classList.add('hidden');
        }
    }
    
    /**
     * Renders the list of tags in the Tag Explorer.
     * @param {Array<Object>} tags - The array of tag objects to render.
     */
    function renderExplorerList(tags) {
        if (tags.length === 0) {
            explorer.tagList.innerHTML = '<li class="tag-item" style="text-align: center;">No tags match the current search.</li>';
            return;
        }

        const fragment = document.createDocumentFragment();
        tags.forEach(tag => {
            const li = document.createElement('li');
            li.className = 'tag-item';
            const categoryClass = getTagCategoryClass(tag.category);
            const fullTagName = tag.category === 'general' ? tag.name : `${tag.category}:${tag.name}`;

            li.innerHTML = `
                <div class="tag-display">
                    <div>
                        <span class="tag-pill ${categoryClass}" style="cursor: default; margin-right: 0.5rem;">${tag.category}</span>
                        <a href="/gallery?q=${encodeURIComponent(fullTagName)}" class="tag-name-link">${tag.name}</a>
                        <span class="tag-count">(${tag.count})</span>
                    </div>
                    <div class="tag-controls">
                        <button class="quick-action-btn action-button" data-action="rename" data-tag-id="${tag.id}" data-full-name="${fullTagName}">Rename</button>
                        <button class="quick-action-btn action-button" data-action="merge" data-tag-id="${tag.id}" data-full-name="${fullTagName}">Merge</button>
                        <button class="quick-action-btn action-button" data-action="change-category" data-tag-id="${tag.id}" data-full-name="${fullTagName}">Category</button>
                        <button class="quick-action-btn action-button danger-action" data-action="delete" data-tag-id="${tag.id}" data-full-name="${fullTagName}">Delete</button>
                    </div>
                </div>
            `;
            fragment.appendChild(li);
        });
        explorer.tagList.appendChild(fragment);
    }
    
    /**
     * Renders pagination controls for the Tag Explorer.
     * @param {Object} data - The response object from the API, containing pagination info.
     */
    function renderPagination(data) {
        const { page, total, limit } = data;
        const totalPages = Math.ceil(total / limit);
        if (totalPages <= 1) return;

        let paginationHtml = '';
        if (page > 1) {
            paginationHtml += `<button class="pagination-btn" data-page="${page - 1}">&laquo; Prev</button>`;
        }
        
        paginationHtml += `<span>Page ${page} of ${totalPages}</span>`;

        if (data.has_more) {
            paginationHtml += `<button class="pagination-btn" data-page="${page + 1}">Next &raquo;</button>`;
        }
        explorer.pagination.innerHTML = paginationHtml;
    }

    /**
     * Populates the category dropdown from the global VALID_CATEGORIES constant.
     */
    function populateCategoryDropdown() {
        // VALID_CATEGORIES is expected to be in ui_helpers.js
        if (typeof VALID_CATEGORIES !== 'undefined') {
            inputs.categoryNewCategory.innerHTML = VALID_CATEGORIES
                .map(c => `<option value="${c}">${c}</option>`)
                .join('');
        }
    }
    
    /**
     * Fetches a single tag object by its full name (e.g., 'artist:someone')
     * to resolve its ID for action panel operations.
     * @param {string} fullTagName - The full name of the tag.
     * @returns {Promise<Object|null>} A promise that resolves to the tag object or null.
     */
    async function findTagObjectByName(fullTagName) {
        const parsed = parseTag(fullTagName);
        const params = new URLSearchParams({
            q: `${parsed.category}:${parsed.name}`,
            limit: 1
        });
        const response = await fetch(`/api/tags/search?${params.toString()}`);
        const data = await response.json();
        // Ensure an exact match since the search is case-insensitive and uses 'like'.
        const foundTag = data.tags.find(t => t.name === parsed.name && t.category === parsed.category);
        return foundTag || null;
    }
    
    /**
     * Sets up all autocomplete inputs in the Action Panel.
     * This now correctly finds and passes the required suggestion containers.
     */
    function setupAllAutocompletes() {
        const bindAutocomplete = (inputEl, suggestionsEl, idEl) => {
            // setupTagAutocomplete is expected to be in autocomplete.js
            // It requires both the input and a suggestions container element.
            setupTagAutocomplete(inputEl, suggestionsEl, {
                onSelect: async (selectedTag) => {
                    const tagObject = await findTagObjectByName(selectedTag);
                    if (tagObject) {
                        inputEl.value = selectedTag; // Keep full name for display
                        idEl.value = tagObject.id;
                    } else {
                        showToast(`Could not verify selected tag: ${selectedTag}`, 'error');
                        idEl.value = '';
                    }
                }
            });
            // Clear the hidden ID if the user manually changes the input text
            inputEl.addEventListener('input', () => {
                if (idEl.value) { idEl.value = ''; }
            });
        };

        // Get all suggestion containers from the DOM
        const suggestions = {
            rename: document.getElementById('suggestions-rename'),
            category: document.getElementById('suggestions-category'),
            mergeDelete: document.getElementById('suggestions-merge-delete'),
            mergeKeep: document.getElementById('suggestions-merge-keep'),
            delete: document.getElementById('suggestions-delete'),
        };

        bindAutocomplete(inputs.renameTag, suggestions.rename, inputs.renameTagId);
        bindAutocomplete(inputs.categoryTag, suggestions.category, inputs.categoryTagId);
        bindAutocomplete(inputs.mergeDeleteTag, suggestions.mergeDelete, inputs.mergeDeleteTagId);
        bindAutocomplete(inputs.mergeKeepTag, suggestions.mergeKeep, inputs.mergeKeepTagId);
        bindAutocomplete(inputs.deleteTag, suggestions.delete, inputs.deleteTagId);
    }

    // --- 4. API HANDLERS ---
    
    async function handleRename() {
        const tagId = inputs.renameTagId.value;
        const newName = inputs.renameNewName.value.trim();
        const oldTagName = inputs.renameTag.value;

        if (!tagId) { showToast('Please select a valid tag to rename.', 'info'); return; }
        if (!newName) { showToast('New name cannot be empty.', 'info'); return; }

        const confirmed = await showConfirmation(`Rename "${oldTagName}" to "${newName}"?`);
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/tags/rename/${tagId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_name: newName })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail);
            showToast(result.message, 'success');
            // Reset form and refresh explorer
            inputs.renameTag.value = '';
            inputs.renameTagId.value = '';
            inputs.renameNewName.value = '';
            fetchExplorerTags();
        } catch (err) {
            showToast(`Rename failed: ${err.message}`, 'error');
        }
    }
    
    async function handleChangeCategory() {
        const tagId = inputs.categoryTagId.value;
        const newCategory = inputs.categoryNewCategory.value;
        const tagName = inputs.categoryTag.value;

        if (!tagId) { showToast('Please select a valid tag to change.', 'info'); return; }
        
        const confirmed = await showConfirmation(`Change category of "${tagName}" to "${newCategory}"?`);
        if (!confirmed) return;
        
        try {
            const response = await fetch(`/api/tags/change_category/${tagId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ new_category: newCategory })
            });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail);
            showToast(result.message, 'success');
            inputs.categoryTag.value = '';
            inputs.categoryTagId.value = '';
            fetchExplorerTags();
        } catch (err) {
            showToast(`Category change failed: ${err.message}`, 'error');
        }
    }
    
    async function handleMerge() {
        const tagIdToDelete = inputs.mergeDeleteTagId.value;
        const tagIdToKeep = inputs.mergeKeepTagId.value;
        const tagNameToDelete = inputs.mergeDeleteTag.value;
        const tagNameToKeep = inputs.mergeKeepTag.value;

        if (!tagIdToDelete || !tagIdToKeep) { showToast('Please select both tags for merging.', 'info'); return; }
        if (tagIdToDelete === tagIdToKeep) { showToast('Cannot merge a tag with itself.', 'info'); return; }

        const confirmed = await showConfirmation(`Merge "${tagNameToDelete}" into "${tagNameToKeep}"? This will delete "${tagNameToDelete}".`);
        if (!confirmed) return;

        const formData = new FormData();
        formData.append('tag_id_to_keep', tagIdToKeep);
        formData.append('tag_id_to_delete', tagIdToDelete);

        try {
            const response = await fetch('/api/tags/merge', { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail);
            showToast(result.message, 'success');
            inputs.mergeDeleteTag.value = '';
            inputs.mergeDeleteTagId.value = '';
            inputs.mergeKeepTag.value = '';
            inputs.mergeKeepTagId.value = '';
            fetchExplorerTags();
        } catch (err) {
            showToast(`Merge failed: ${err.message}`, 'error');
        }
    }
    
    async function handleDelete() {
        const tagId = inputs.deleteTagId.value;
        const tagName = inputs.deleteTag.value;
        
        if (!tagId) { showToast('Please select a valid tag to delete.', 'info'); return; }

        const confirmed = await showConfirmation(`PERMANENTLY DELETE the tag "${tagName}"? This cannot be undone.`);
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/tags/force_delete/${tagId}`, { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail);
            showToast(result.message, 'success');
            inputs.deleteTag.value = '';
            inputs.deleteTagId.value = '';
            fetchExplorerTags();
        } catch (err) {
            showToast(`Deletion failed: ${err.message}`, 'error');
        }
    }
    
    async function handleDeleteAllOrphans() {
        const confirmed = await showConfirmation(`Are you sure you want to delete ALL orphan tags? This cannot be undone.`);
        if (!confirmed) return;

        try {
            const response = await fetch('/api/tags/delete_orphans', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail);
            showToast(result.message, 'success');
            fetchExplorerTags(); // Refresh the list
        } catch (err) {
            showToast(`Failed to delete orphan tags: ${err.message}`, 'error');
        }
    }
    
    // --- 5. INITIALIZATION & EVENT LISTENERS ---

    function initializeEventListeners() {
        // Action Panel
        actionSelect.addEventListener('change', switchActionForm);
        buttons.rename.addEventListener('click', handleRename);
        buttons.changeCategory.addEventListener('click', handleChangeCategory);
        buttons.merge.addEventListener('click', handleMerge);
        buttons.delete.addEventListener('click', handleDelete);
        buttons.deleteAllOrphans.addEventListener('click', handleDeleteAllOrphans);

        // Tag Explorer Controls
        let searchTimeout;
        explorer.searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                explorerState.query = explorer.searchInput.value.trim();
                explorerState.currentPage = 1;
                fetchExplorerTags();
            }, 300); // Debounce search input
        });
        
        explorer.showOrphansOnly.addEventListener('change', () => {
            explorerState.showOrphans = explorer.showOrphansOnly.checked;
            explorerState.currentPage = 1;
            fetchExplorerTags();
        });
        
        explorer.sortSelect.addEventListener('change', () => {
            explorerState.sortBy = explorer.sortSelect.value;
            explorerState.currentPage = 1;
            fetchExplorerTags();
        });
        
        // Delegated listener for pagination, quick actions, and mobile toggling
        explorer.tagList.parentElement.addEventListener('click', (e) => {
            const target = e.target;
            
            // Pagination
            if (target.matches('.pagination-btn')) {
                explorerState.currentPage = parseInt(target.dataset.page, 10);
                fetchExplorerTags();
                return; // Prevent other handlers from firing
            }

            // Quick Actions
            const quickActionButton = target.closest('.quick-action-btn');
            if (quickActionButton) {
                e.preventDefault();
                const action = quickActionButton.dataset.action;
                const tagId = quickActionButton.dataset.tagId;
                const fullName = quickActionButton.dataset.fullName;
                
                if (action === 'rename') {
                    actionSelect.value = 'rename';
                    switchActionForm();
                    inputs.renameTag.value = fullName;
                    inputs.renameTagId.value = tagId;
                    inputs.renameNewName.focus();
                } else if (action === 'merge') {
                    actionSelect.value = 'merge';
                    switchActionForm();
                    inputs.mergeDeleteTag.value = fullName;
                    inputs.mergeDeleteTagId.value = tagId;
                    inputs.mergeKeepTag.focus();
                } else if (action === 'change-category') {
                    actionSelect.value = 'change-category';
                    switchActionForm();
                    inputs.categoryTag.value = fullName;
                    inputs.categoryTagId.value = tagId;
                    inputs.categoryNewCategory.focus();
                } else if (action === 'delete') {
                    actionSelect.value = 'delete';
                    switchActionForm();
                    inputs.deleteTag.value = fullName;
                    inputs.deleteTagId.value = tagId;
                    buttons.delete.focus();
                }
                
                // Scroll to the top to see the action panel
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return; // Prevent other handlers from firing
            }

            // Mobile tap-to-reveal logic
            const clickedItem = target.closest('.tag-item');
            if (window.innerWidth <= 768 && clickedItem) {
                // Don't toggle if a link was clicked
                if (target.tagName === 'A') return;

                const currentActive = explorer.tagList.querySelector('.tag-item.active');
                if (currentActive && currentActive !== clickedItem) {
                    currentActive.classList.remove('active');
                }
                clickedItem.classList.toggle('active');
            }
        });
    }

    // --- 6. START THE APPLICATION ---
    explorer.showOrphansOnly.checked = false; // Ensure checkbox is reset on page load
    switchActionForm(); // Set initial form visibility
    populateCategoryDropdown();
    setupAllAutocompletes();
    initializeEventListeners();
    fetchExplorerTags(); // Initial load for the explorer
});