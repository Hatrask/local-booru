/**
 * shared_gallery.js
 *
 * This file provides a reusable "gallery manager" for pages that display a paginated
 * grid of images (like the main gallery and the batch actions page). It handles all
 * the common logic for fetching data, pagination, keyboard navigation, and
 * browser history management.
 *
 * It is designed to be configurable, allowing the calling page to provide its own
 * rendering logic and callbacks.
 */

/**
 * Creates and initializes a manager for a gallery grid.
 *
 * @param {object} options - The configuration object for the manager.
 * @param {string} options.searchQuery - The initial search query.
 * @param {number} options.imagesPerPage - The number of images to display per page.
 * @param {HTMLElement} options.galleryGridEl - The container element for the image grid.
 * @param {HTMLElement} options.paginationEl - The container element for pagination controls.
 * @param {string} options.pageUrl - The base URL for the page (e.g., '/gallery' or '/batch_actions').
 * @param {Function} options.renderItem - A callback function to render a single item in the grid. Can be async.
 * @param {Function} [options.onPageLoad] - An optional callback that fires after a new page of images is loaded.
 */
function createGalleryManager(options) {
    const {
        searchQuery,
        imagesPerPage,
        galleryGridEl,
        paginationEl,
        pageUrl,
        renderItem,
        onPageLoad
    } = options;

    let currentPage = new URLSearchParams(window.location.search).get('page') || 1;
    let totalPages = 0;
    let totalImages = 0;
    let hasMorePages = true;
    let isLoading = false;
    let currentImagesOnPage = [];

    /**
     * Fetches image data from the API and orchestrates the rendering of the page.
     * @param {number} pageToLoad - The page number to fetch and display.
     */
    async function loadPage(pageToLoad = 1) {
        if (isLoading) return;
        isLoading = true;
        galleryGridEl.innerHTML = '<p>Loading images...</p>'; 
        currentPage = parseInt(pageToLoad, 10);

        const newUrl = `${pageUrl}?q=${encodeURIComponent(searchQuery)}&page=${currentPage}`;
        window.history.pushState({ page: currentPage, query: searchQuery }, '', newUrl);

        if (searchQuery) {
            addRecentSearch(searchQuery);
        }

        try {
            const response = await fetch(`/api/images?q=${encodeURIComponent(searchQuery)}&page=${currentPage}&limit=${imagesPerPage}`);
            if (!response.ok) throw new Error(`HTTP error! Status: ${response.status}`);
            
            const data = await response.json();
            currentImagesOnPage = data.images;
            totalPages = Math.ceil(data.total / imagesPerPage);
            totalImages = data.total;
            hasMorePages = data.has_more;

            await renderGallery(data.images);
            renderPagination();
            
            // NOTE: The onPageLoad callback in gallery.js can now be simplified.
            // It no longer needs to handle rendering itself.
            if (typeof onPageLoad === 'function') {
                onPageLoad(data.images);
            }

        } catch (err) {
            console.error("Failed to load images:", err);
            galleryGridEl.innerHTML = '<p style="text-align: center; color: var(--color-danger);">Error loading images.</p>';
        } finally {
            isLoading = false;
        }
    }

    /**
     * Renders the grid of image thumbnails using the provided `renderItem` callback.
     * @param {Array<Object>} images - An array of image objects from the API.
     */
    async function renderGallery(images) {
        galleryGridEl.innerHTML = '';
        if (images.length === 0) {
            galleryGridEl.innerHTML = '<p style="text-align: center;">No images found.</p>';
            return;
        }

        const itemPromises = images.map((img, index) => renderItem(img, index));
        const itemElements = await Promise.all(itemPromises);
        galleryGridEl.append(...itemElements.filter(el => el));
    }


    /**
     * Renders the pagination controls.
     */
    function renderPagination() {
        paginationEl.innerHTML = '';
        if (totalImages === 0) return;

        paginationEl.innerHTML = `
            <p style="margin-bottom: 0.5rem;">Page ${currentPage} of ${totalPages} (${totalImages} images)</p>
            <button id="prev-page" ${currentPage <= 1 ? 'disabled' : ''}>← Previous</button>
            <button id="next-page" ${!hasMorePages ? 'disabled' : ''}>Next →</button>
        `;

        document.getElementById('prev-page').addEventListener('click', () => loadPage(currentPage - 1));
        document.getElementById('next-page').addEventListener('click', () => loadPage(currentPage + 1));
    }

    /**
     * Handles global keydown events for pagination shortcuts.
     * @param {KeyboardEvent} e - The keyboard event.
     */
    function handleKeydown(e) {
        if (e.target.matches('input, textarea, select')) return;

        const lightboxIsOpen = document.getElementById('lightbox-modal')?.style.display === 'flex';
        if (lightboxIsOpen) return;

        switch (e.key.toLowerCase()) {
            case 'a':
            case 'arrowleft':
                const prevBtn = document.getElementById('prev-page');
                if (prevBtn && !prevBtn.disabled) {
                    loadPage(currentPage - 1);
                }
                break;
            case 'd':
            case 'arrowright':
                const nextBtn = document.getElementById('next-page');
                if (nextBtn && !nextBtn.disabled) {
                    loadPage(currentPage + 1);
                }
                break;
        }
    }

    // --- INITIALIZATION ---
    document.addEventListener('keydown', handleKeydown);
    window.addEventListener('popstate', (e) => {
        const newPage = e.state?.page || 1;
        if (newPage !== currentPage) {
            loadPage(newPage);
        }
    });
    
    loadPage(currentPage);

	return {
        reload: (page) => loadPage(page),
        goToNextPage: () => {
            if (hasMorePages) {
                loadPage(currentPage + 1);
            }
        },
        goToPrevPage: () => {
            if (currentPage > 1) {
                loadPage(currentPage - 1);
            }
        },
        getCurrentPage: () => currentPage,
        getHasMorePages: () => hasMorePages
    };
}