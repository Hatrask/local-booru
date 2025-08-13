/**
 * gallery.js
 *
 * This script manages the functionality of the main gallery page.
 * It uses the shared gallery manager for pagination and data fetching,
 * and adds its own unique features:
 * - A powerful lightbox for viewing and editing images.
 * - A tag tooltip system for quick inspection of image tags.
 * - Thumbnail size controls.
 */
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. CONFIGURATION & CONSTANTS ---
    const IMAGES_PER_PAGE = 100;
    const DEFAULT_THUMB_SIZE = '250';
    const TOOLTIP_SHOW_DELAY = 100;
    const TOOLTIP_HIDE_DELAY = 50;
    const TOOLTIP_MODE_KEY = 'localBooru_tooltipModeEnabled';

    // --- 2. DOM ELEMENT REFERENCES ---
    const galleryGrid = document.getElementById('gallery-grid');
    const paginationDiv = document.getElementById('pagination');
    const thumbnailControls = document.getElementById('thumbnail-controls');
    const mainTagInput = document.getElementById('tagInput');
    const mainSuggestionsBox = document.querySelector('.suggestions');
    const tagTooltip = document.getElementById('tag-tooltip');

    // Lightbox elements
    const lightboxModal = document.getElementById('lightbox-modal');
    const lightboxContent = document.getElementById('lightbox-content');
    const lightboxImage = document.getElementById('lightbox-image');
    const lightboxClose = document.getElementById('lightbox-close');
    const lightboxPrev = document.getElementById('lightbox-prev');
    const lightboxNext = document.getElementById('lightbox-next');
    const lightboxLoadingIndicator = document.getElementById('lightbox-loading-indicator');
    
    // Lightbox state-specific elements
    // Note: lightboxTagsDisplay is now inside lightbox-view-mode-content
    const lightboxViewModeContent = document.getElementById('lightbox-view-mode-content');
    const lightboxImageId = lightboxViewModeContent.querySelector('#lightbox-image-id');
    const lightboxTagsDisplay = lightboxViewModeContent.querySelector('.tag-pills-container');
    const lightboxEditBtn = lightboxViewModeContent.querySelector('#lightbox-edit-btn');
    const lightboxDeleteBtn = lightboxViewModeContent.querySelector('#lightbox-delete-btn');
    
    const lightboxSaveBtn = document.getElementById('lightbox-save-btn');
    const lightboxCancelBtn = document.getElementById('lightbox-cancel-btn');
    const lightboxTagInput = document.getElementById('lightbox-tag-input');
    const lightboxTagEditorPills = document.getElementById('lightbox-tag-editor-pills');

    // Tag Helper Elements
    const tagHelperTitle = document.getElementById('tag-helper-title');
    const tagHelperContentArea = document.getElementById('tag-helper-content-area');

    // --- 3. STATE MANAGEMENT ---
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q') || "";
    let currentImages = []; // This will be populated by the gallery manager
    let currentImageIndex = -1;
    let showTooltipTimer, hideTooltipTimer;
    let isTooltipModeEnabled = localStorage.getItem(TOOLTIP_MODE_KEY) === 'true';
    let lightboxEditStateTags = new Set();
    let searchDebounceTimer;
    let galleryManager;
    let currentPage = parseInt(urlParams.get('page'), 10) || 1;
    let lightboxNavDirection = 0; // 1 for forward, -1 for backward

    // --- 4. RENDERER FOR THE SHARED MANAGER ---

    /**
     * Creates a thumbnail element for the main gallery. This function is passed
     * as a callback to the shared gallery manager.
     * @param {object} img - The image object from the API.
     * @param {number} index - The index of the image on the current page.
     * @returns {HTMLElement} The created thumbnail element.
     */
    function renderGalleryItem(img, index) {
        const thumb = document.createElement('div');
        thumb.className = 'thumb';
        thumb.dataset.index = index;
        thumb.innerHTML = `<img src="/media/images/${img.filename}" alt="Image ${img.id}" loading="lazy">`;
        thumb.addEventListener('click', () => openLightbox(index));
        return thumb;
    }

    // --- 5. PAGE-SPECIFIC LOGIC (LIGHTBOX, TOOLTIPS, etc.) ---

    /**
     * Displays the lightbox modal for a specific image.
     * @param {number} index - The index of the image to show from the `currentImages` array.
     */
    function openLightbox(index) {
        hideTooltip();
        currentImageIndex = index;
        const image = currentImages[currentImageIndex];
        if (!image) return;

        showImageInLightbox(image);
        setLightboxMode('view');
        lightboxModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    /**
     * Hides the lightbox modal.
     */
    function closeLightbox() {
        lightboxModal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
    
    async function setLightboxMode(mode) { // 'view' or 'edit'
        if (mode === 'edit') {
            lightboxContent.classList.remove('view-mode');
            lightboxContent.classList.add('edit-mode');
            renderTagEditor();
            await showRecentsInHelper();
        } else {
            lightboxContent.classList.remove('edit-mode');
            lightboxContent.classList.add('view-mode');
        }
    }

    /**
     * Loads the image and its metadata into the lightbox view.
     * @param {Object} image - The image object to display.
     */
    function showImageInLightbox(image) {
        if (!image) return;
        lightboxImage.src = `/media/images/${image.filename}`;
        lightboxImage.alt = `Image ID: ${image.id}`;
        
        // --- View Mode Setup ---
        lightboxImageId.textContent = `Image ID: ${image.id}`;
        lightboxTagsDisplay.innerHTML = renderTagPills(image.tags, false);
        
        // --- Button data attributes ---
        lightboxDeleteBtn.dataset.imageId = image.id;
        lightboxSaveBtn.dataset.imageId = image.id;
    }

    function renderTagEditor() {
        const image = currentImages[currentImageIndex];
        if (!image) return;

        lightboxEditStateTags.clear();
        image.tags.forEach(tag => {
            const rawTagName = tag.category === 'general' ? tag.name : `${tag.category}:${tag.name}`;
            lightboxEditStateTags.add(rawTagName);
        });
        
        updateEditorPills();
    }

    function updateEditorPills() {
        lightboxTagEditorPills.innerHTML = '';
        const sortedTags = Array.from(lightboxEditStateTags).sort();
        sortedTags.forEach(rawTagName => {
            const { name, category } = parseTag(rawTagName);
            const categoryClass = getTagCategoryClass(category);
            const pill = document.createElement('span');
            pill.className = `tag-pill ${categoryClass}`;
            pill.dataset.tag = rawTagName;
            pill.innerHTML = `${name}<button class="remove-tag-btn">×</button>`;
            lightboxTagEditorPills.appendChild(pill);
        });
    }

    async function handleSaveTags() {
        const imageId = lightboxSaveBtn.dataset.imageId;
        if (!imageId) return;

        try {
            const response = await fetch(`/api/image/${imageId}/tags`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ tags: Array.from(lightboxEditStateTags) })
            });

            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.detail || 'Failed to save tags.');
            }
            
            const result = await response.json();
            currentImages[currentImageIndex].tags = result.tags;

            showToast('Tags saved successfully!', 'success');
            showImageInLightbox(currentImages[currentImageIndex]);
            setLightboxMode('view');

        } catch (error) {
            console.error('Error saving tags:', error);
            showToast(error.message, 'error');
        }
    }

    async function handleDelete(event) {
        const imageId = event.target.dataset.imageId;
        if (!imageId) return;
        const confirmed = await showConfirmation('Are you sure you want to permanently delete this image? This cannot be undone.');
        if (!confirmed) return;
        try {
            const response = await fetch(`/api/image/${imageId}`, { method: 'DELETE' });
            if (response.ok) {
                showToast('Image deleted successfully.', 'success');
                closeLightbox();
                galleryManager.reload(currentPage);
            } else {
                const result = await response.json();
                showToast(result.detail || 'Failed to delete image.', 'error');
            }
        } catch (error) {
            console.error('Error deleting image:', error);
            showToast('An unexpected error occurred.', 'error');
        }
    }

    /**
     * Handles navigation within the lightbox, including loading subsequent pages.
     * @param {number} direction - `1` for next, `-1` for previous.
     */
    async function navigateLightbox(direction) {
        const newIndex = currentImageIndex + direction;

        // If the next image is on the current page, just open it.
        if (newIndex >= 0 && newIndex < currentImages.length) {
            openLightbox(newIndex); // Re-opens lightbox for the new image
            return;
        }

        // If we're at an edge, we need to check if we can load another page
        // before showing the loader. This prevents the loader from getting stuck.
        if (direction === 1 && !galleryManager.getHasMorePages()) {
            return; // At the very end of the gallery, do nothing.
        }
        if (direction === -1 && galleryManager.getCurrentPage() <= 1) {
            return; // At the very beginning of the gallery, do nothing.
        }

        // We need to load a new page. Set the direction and let the manager handle it.
        // The onPageLoad callback will use the direction to open the correct image.
        lightboxNavDirection = direction;
        lightboxLoadingIndicator.style.display = 'block';

        if (direction === 1) {
            galleryManager.goToNextPage();
        } else if (direction === -1) {
            galleryManager.goToPrevPage();
        }
    }

    function renderTagCloudInHelper(tags, container) {
        container.innerHTML = '';
        if (!tags || tags.length === 0) {
            container.innerHTML = '<p>No tags found.</p>';
            return;
        }

        tags.forEach(rawTagName => {
            const { name, category } = parseTag(rawTagName);
            const pill = document.createElement('a');
            pill.href = '#';
            pill.className = `tag-pill ${getTagCategoryClass(category)}`;
            pill.textContent = name;
            pill.dataset.tag = rawTagName;
            container.appendChild(pill);
        });
    }

    async function showRecentsInHelper() {
        tagHelperTitle.textContent = 'Recent Tags';
        try {
            const response = await fetch('/api/tags/recent?limit=50');
            if (!response.ok) throw new Error('Could not fetch recent tags.');
            const tags = await response.json();
            renderTagCloudInHelper(tags, tagHelperContentArea);
        } catch (error) {
            console.error(error);
            tagHelperContentArea.innerHTML = '<p>Error loading tags.</p>';
        }
    }

    async function showSearchResultsInHelper(query) {
        tagHelperTitle.textContent = 'Search Results';
        try {
            const response = await fetch(`/api/tags/autocomplete?q=${encodeURIComponent(query)}&limit=50`);
            if (!response.ok) throw new Error('Tag search failed');
            const tags = await response.json();
            renderTagCloudInHelper(tags, tagHelperContentArea);
        } catch (error) {
            console.error(error);
            tagHelperContentArea.innerHTML = '<p>Error searching tags.</p>';
        }
    }

    function addTagFromHelper(rawTagName) {
        lightboxEditStateTags.add(rawTagName);
        updateEditorPills();
    }

    /**
     * Sets the CSS variable for thumbnail width and saves the preference to localStorage.
     * @param {string} size - The width in pixels (e.g., "250").
     */
    function applyThumbSize(size) {
        document.documentElement.style.setProperty('--thumb-width', `${size}px`);
        localStorage.setItem('thumbSize', size);
        thumbnailControls.querySelector('.active')?.classList.remove('active');
        thumbnailControls.querySelector(`[data-size="${size}"]`)?.classList.add('active');
    }

    /**
     * Hides the dynamic tooltip and clears any pending timers.
     */
    function hideTooltip() {
        clearTimeout(showTooltipTimer);
        clearTimeout(hideTooltipTimer);
        tagTooltip.classList.remove('visible');
    }

    /**
     * Calculates the optimal position for the tooltip and displays it.
     * @param {HTMLElement} thumb - The thumbnail element being hovered.
     * @param {MouseEvent} event - The mouse event that triggered the display.
     */
    function showTooltip(thumb, event) {
        const index = parseInt(thumb.dataset.index, 10);
        const image = currentImages[index];
        if (!image || !image.tags) return;

        tagTooltip.innerHTML = renderTagPills(image.tags, false);
        
        // Use a temporary class to calculate dimensions without a visual flicker.
        tagTooltip.classList.add('visible-calculating');
        const tooltipRect = tagTooltip.getBoundingClientRect();
        tagTooltip.classList.remove('visible-calculating');

        let left = event.clientX + 15;
        let top = event.clientY + 15;

        // Smartly adjust position to prevent overflowing the viewport.
        if (left + tooltipRect.width > window.innerWidth) {
            left = event.clientX - tooltipRect.width - 15;
        }
        if (top + tooltipRect.height > window.innerHeight) {
            top = event.clientY - tooltipRect.height - 15;
        }

        tagTooltip.style.left = `${left}px`;
        tagTooltip.style.top = `${top}px`;
        tagTooltip.classList.add('visible');
    }

    /**
     * Sets up the event listeners for the dynamic tooltip.
     */
    function setupTooltipEvents() {
        galleryGrid.addEventListener('mouseover', e => {
            if (!isTooltipModeEnabled) return;
            const thumb = e.target.closest('.thumb');
            if (thumb) {
                clearTimeout(hideTooltipTimer);
                showTooltipTimer = setTimeout(() => showTooltip(thumb, e), TOOLTIP_SHOW_DELAY);
            }
        });

        galleryGrid.addEventListener('mouseout', e => {
            if (!isTooltipModeEnabled) return;
            const thumb = e.target.closest('.thumb');
            if (thumb) {
                clearTimeout(showTooltipTimer);
                hideTooltipTimer = setTimeout(hideTooltip, TOOLTIP_HIDE_DELAY);
            }
        });
        
        tagTooltip.addEventListener('mouseover', () => { if (!isTooltipModeEnabled) return; clearTimeout(hideTooltipTimer); });
        tagTooltip.addEventListener('mouseout', () => { if (!isTooltipModeEnabled) return; hideTooltipTimer = setTimeout(hideTooltip, TOOLTIP_HIDE_DELAY); });
    }

    /**
     * Handles page-specific keyboard shortcuts, like toggling tooltips.
     * Note: Pagination shortcuts are now handled by the shared manager.
     * @param {KeyboardEvent} e The keyboard event.
     */
    function handleGalleryKeydown(e) {
		if (e.target.matches('input, textarea')) return;

        // --- Lightbox is OPEN ---
        if (lightboxModal.style.display === 'flex') {
            // Handle Escape key first, as it applies to both modes.
            if (e.key === 'Escape') {
                e.preventDefault();
                if (lightboxContent.classList.contains('edit-mode')) {
                    setLightboxMode('view');
                    showImageInLightbox(currentImages[currentImageIndex]);
                } else {
                    closeLightbox();
                }
                return;
            }

            // --- In VIEW MODE ---
            if (lightboxContent.classList.contains('view-mode')) {
                 if (e.target.matches('input, textarea')) return;

                // Handle Shift+D for deletion first to prevent fall-through.
                if (e.shiftKey && e.key.toLowerCase() === 'd') {
                    e.preventDefault();
                    lightboxDeleteBtn.click();
                    return; // Explicitly stop here so it doesn't trigger navigation.
                }

                switch (e.key.toLowerCase()) {
                    case 'd':
                    case 'arrowright':
                        navigateLightbox(1);
                        break;
                    case 'a':
                    case 'arrowleft':
                        navigateLightbox(-1);
                        break;
                    case 'e':
                        setLightboxMode('edit');
                        break;
                }
            }
            // --- In EDIT MODE ---
            else if (lightboxContent.classList.contains('edit-mode')) {
                // Do not trigger shortcuts if the user is focused on the tag input field.
                if (document.activeElement === lightboxTagInput) {
                    return;
                }

                switch (e.key.toLowerCase()) {
                    case 's':
                        e.preventDefault();
                        lightboxSaveBtn.click();
                        break;
                    case 'c':
                        e.preventDefault();
                        lightboxTagInput.value = '';
                        clearTimeout(searchDebounceTimer);
                        showRecentsInHelper();
                        break;
                }
            }
        }
        // --- Lightbox is CLOSED ---
        else {
            if (e.key.toLowerCase() === 't') {
                isTooltipModeEnabled = !isTooltipModeEnabled;
                localStorage.setItem(TOOLTIP_MODE_KEY, isTooltipModeEnabled);
                showToast(`Tooltip mode ${isTooltipModeEnabled ? 'enabled' : 'disabled'}.`, 'info');
                if (!isTooltipModeEnabled) hideTooltip();
            }
        }
    }

    // --- 6. INITIALIZATION ---

    function initialize() {
        // Initial setup calls
        const savedSize = localStorage.getItem('thumbSize') || DEFAULT_THUMB_SIZE;
        applyThumbSize(savedSize);

        // General event listeners
        lightboxClose.addEventListener('click', closeLightbox);
        lightboxModal.addEventListener('click', (e) => {
            // If the user clicks on the dark backdrop of the modal, close it.
            if (e.target === lightboxModal) {
                closeLightbox();
            }
        });

        lightboxPrev.addEventListener('click', () => navigateLightbox(-1));
        lightboxNext.addEventListener('click', () => navigateLightbox(1));

        document.addEventListener('keydown', handleGalleryKeydown);

        thumbnailControls.addEventListener('click', (e) => {
            if (e.target.dataset.size) { applyThumbSize(e.target.dataset.size); }
        });

        // Lightbox state change listeners
        lightboxEditBtn.addEventListener('click', () => setLightboxMode('edit'));
        lightboxCancelBtn.addEventListener('click', () => {
            setLightboxMode('view');
            showImageInLightbox(currentImages[currentImageIndex]); // Restore original tags on cancel
        });

        lightboxSaveBtn.addEventListener('click', handleSaveTags);
        lightboxDeleteBtn.addEventListener('click', handleDelete);
        
        // Lightbox tag editor listeners
        lightboxTagEditorPills.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-tag-btn')) {
                const pill = e.target.closest('.tag-pill');
                if (pill) {
                    lightboxEditStateTags.delete(pill.dataset.tag);
                    updateEditorPills();
                }
            }
        });
        
        lightboxTagInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                const tagValue = e.target.value.trim().toLowerCase();
                if (tagValue) {
                    lightboxEditStateTags.add(tagValue);
                    updateEditorPills();
                    e.target.value = '';
                    showRecentsInHelper();
                }
            }
        });

        lightboxTagInput.addEventListener('input', (e) => {
            const query = e.target.value.trim();
            clearTimeout(searchDebounceTimer);
            if (query.length > 1) {
                searchDebounceTimer = setTimeout(() => showSearchResultsInHelper(query), 200);
            } else {
                showRecentsInHelper();
            }
        });

        tagHelperContentArea.addEventListener('click', (e) => {
            if (e.target.matches('a.tag-pill')) {
                e.preventDefault();
                addTagFromHelper(e.target.dataset.tag);
            }
        });

        // Setup main page components
        setupTooltipEvents();
        setupTagAutocomplete(mainTagInput, mainSuggestionsBox, { showSavedSearches: true });

        // Initialize the shared gallery manager
        galleryManager = createGalleryManager({
            searchQuery: query,
            imagesPerPage: IMAGES_PER_PAGE,
            galleryGridEl: galleryGrid,
            paginationEl: paginationDiv,
            pageUrl: '/gallery',
            renderItem: renderGalleryItem,
            onPageLoad: (images) => {
                currentImages = images;
                currentPage = galleryManager.getCurrentPage();
                hideTooltip();

                // This logic block handles opening the lightbox after a page navigation.
                if (lightboxLoadingIndicator.style.display === 'block') {
                    lightboxLoadingIndicator.style.display = 'none';

                    const newIndex = lightboxNavDirection === 1 ? 0 : currentImages.length - 1;
                    openLightbox(newIndex);
                    
                    // Reset the direction tracker after use.
                    lightboxNavDirection = 0;
                }
            }
        });
    }

    // START THE APPLICATION
    initialize();
});