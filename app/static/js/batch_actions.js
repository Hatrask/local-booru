/**
 * batch_actions.js
 *
 * This script manages the functionality of the batch actions page.
 * It uses the shared gallery manager for pagination and data fetching,
 * and adds its own unique features:
 * - Image selection system (persisted in localStorage).
 * - UI for performing batch tagging and deletion.
 * - Undo functionality for the last tagging operation.
 */
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. CONFIGURATION & DOM REFERENCES ---
    const IMAGES_PER_PAGE = 54;
    const galleryGrid = document.getElementById('gallery-grid');
    const selectedCountSpan = document.getElementById('selected-count');
    const batchTagsInput = document.getElementById('batchTagsInput');
    const actionSelect = document.getElementById('actionSelect');
    const tagsInputContainer = document.getElementById('tags-input-container');
    const searchInput = document.getElementById('search-input');
    const suggestionsSearchBox = document.getElementById('suggestions-search');
    const suggestionsBatchBox = document.getElementById('suggestions-batch');
    const applyActionBtn = document.getElementById('applyActionBtn');

    // --- 2. STATE MANAGEMENT ---
    const urlParams = new URLSearchParams(window.location.search);
    const query = urlParams.get('q') || "";
    let currentImagesOnPage = []; // Populated by the gallery manager
    let selectedImageIds = new Set(JSON.parse(localStorage.getItem('batchSelectedImageIds') || "[]"));

    // --- 3. RENDERER FOR THE SHARED MANAGER ---

    /**
     * Creates a thumbnail element for the batch actions page. This is the key
     * callback passed to the shared gallery manager.
     * @param {object} img - The image object from the API.
     * @returns {HTMLElement} The created thumbnail element.
     */
    function renderBatchItem(img) {
        const thumb = document.createElement('div');
        thumb.className = 'thumb';
        thumb.dataset.imageId = img.id;
        if (selectedImageIds.has(img.id)) {
            thumb.classList.add('selected');
        }

        const imgEl = document.createElement('img');
        
        // Construct the direct URL to the static thumbnail file.
        // We get the base name (without extension) and append .jpg.
        const baseFilename = img.filename.substring(0, img.filename.lastIndexOf('.'));
        imgEl.src = `/media/thumbnails/${baseFilename}.jpg`;
        
        imgEl.alt = `Image ${img.id}`;
        // Use native browser lazy loading for a free performance boost.
        imgEl.loading = 'lazy';

        // renderTagPills is provided by ui_helpers.js
        const tagsHTML = `<div class="tag-pills-container">${renderTagPills(img.tags)}</div>`;

		// If the thumbnail fails to load, replace it with a placeholder SVG.
		imgEl.onerror = function() {
			this.onerror = null;
			this.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='250' height='250' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23e0e0e0'/%3E%3Ctext x='50' y='55' font-family='sans-serif' font-size='12' fill='%239e9e9e' text-anchor='middle'%3EError%3C/text%3E%3C/svg%3E";
		};

        // Construct the element by appending, not using innerHTML, to keep the live image element.
        thumb.appendChild(imgEl);
        thumb.insertAdjacentHTML('beforeend', `<div class="tags">${tagsHTML}</div>`);

        // Apply special styling for the 'favorite' tag.
        const isFavorite = img.tags.some(tag => tag.category === 'metadata' && tag.name === 'favorite');
        if (isFavorite) {
            // Find the pill among all metadata tags based on its text content.
            const metadataPills = thumb.querySelectorAll('.tag-pills-container .tag-metadata');
            const favoritePill = Array.from(metadataPills).find(pill => pill.textContent.trim() === 'favorite');
            
            if (favoritePill) {
                favoritePill.dataset.tag = 'metadata:favorite';
            }
        }

        return thumb;
    }

    // --- 4. INITIALIZE THE GALLERY MANAGER ---
    // This is the core of the fix. The manager is created immediately, ensuring
    // it is available to all functions defined below this point.
    const galleryManager = createGalleryManager({
        searchQuery: query,
        imagesPerPage: IMAGES_PER_PAGE,
        galleryGridEl: galleryGrid,
        paginationContainersSelector: '.pagination',
        pageUrl: '/batch_actions',
        renderItem: renderBatchItem,
        onPageLoad: (images) => {
            currentImagesOnPage = images;
        }
    });

    // --- 5. PAGE-SPECIFIC LOGIC (SELECTION, BATCH ACTIONS) ---

	/**
	 * Updates the selected count display and saves the current selection to localStorage.
	 */
	function updateSelection() {
		selectedCountSpan.textContent = selectedImageIds.size;
		localStorage.setItem('batchSelectedImageIds', JSON.stringify(Array.from(selectedImageIds)));
	}
    
	/**
	 * A UI helper to show/hide the tag input based on the selected action.
	 */
	function toggleTagInputVisibility() {
		const isDeleteAction = actionSelect.value === 'delete';
		tagsInputContainer.style.display = isDeleteAction ? 'none' : 'block';
		applyActionBtn.classList.toggle('danger', isDeleteAction);
	}

	/**
	 * Handles the API call to add, remove, or replace tags on a batch of images.
	 * @param {Array<number>} imageIds - The IDs of the images to modify.
	 * @param {string} action - The action to perform ('add', 'remove', or 'replace').
	 */
	async function handleBatchRetag(imageIds, action) {
		const tags = batchTagsInput.value.trim();
		if (!tags && action !== 'replace') {
			showToast(`The '${action}' action requires at least one tag.`, 'info');
			return;
		}
		const payload = new FormData();
		payload.append("tags", tags);
		payload.append("action", action);
		imageIds.forEach(id => payload.append("image_ids", id));

		try {
			const response = await fetch("/api/images/batch_retag", { method: "POST", body: payload });
			const result = await response.json();
			if (response.ok) {
				showToast(result.message || 'Tags updated successfully!', 'success');
				batchTagsInput.value = "";
				selectedImageIds.clear();
				updateSelection();
				galleryManager.reload(galleryManager.getCurrentPage());
			} else {
				showToast(result.detail || 'Tag update failed.', 'error');
			}
		} catch (err) {
			showToast("An unexpected error occurred. Check console.", 'error');
            console.error("Batch retag error:", err);
		}
	}

	/**
	 * Handles the API call to permanently delete a batch of images.
	 * @param {Array<number>} imageIds - The IDs of the images to delete.
	 */
	async function handleBatchDelete(imageIds) {
		const confirmed = await showConfirmation(`Are you sure you want to PERMANENTLY DELETE ${imageIds.length} selected image(s)? This cannot be undone.`);
		if (!confirmed) return;

		const payload = new FormData();
		imageIds.forEach(id => payload.append("image_ids", id));
		try {
			const response = await fetch('/api/images/batch_delete', { method: 'POST', body: payload });
			const result = await response.json();
			if (response.ok) {
				showToast(result.message || 'Images deleted successfully.', 'success');
				selectedImageIds.clear();
				updateSelection();
				galleryManager.reload(galleryManager.getCurrentPage());
			} else {
				showToast(result.detail || 'Deletion failed.', 'error');
			}
		} catch (error) {
			showToast('An unexpected error occurred during deletion.', 'error');
            console.error("Batch delete error:", error);
		}
	}
    
	/**
	 * Orchestrates the batch action, calling the appropriate handler based on the user's choice.
	 */
	async function handleApplyAction() {
		const selectedAction = actionSelect.value;
		const imageIds = Array.from(selectedImageIds);

		if (imageIds.length === 0) {
			showToast("Please select at least one image.", 'info');
			return;
		}

		if (selectedAction === 'delete') {
			await handleBatchDelete(imageIds);
		} else {
			await handleBatchRetag(imageIds, selectedAction);
		}
	}

    // --- 6. INITIALIZATION ---

	/**
	 * Sets up the application by attaching all necessary event listeners.
	 */
	function initializeEventListeners() {
		// Setup listeners for all the batch action controls
		galleryGrid.addEventListener('click', (e) => {
			const thumb = e.target.closest('.thumb');
			if (thumb) {
				const id = parseInt(thumb.dataset.imageId);
				if (selectedImageIds.has(id)) {
					selectedImageIds.delete(id);
				} else {
					selectedImageIds.add(id);
				}
				thumb.classList.toggle('selected');
				updateSelection();
			}
		});

		// Listeners for the selection control buttons
		document.getElementById('selectAllBtn').addEventListener('click', () => {
			const spaceAvailable = 500 - selectedImageIds.size;
			if (currentImagesOnPage.length > 0 && spaceAvailable <= 0) {
				showToast('You have already selected 500 images.', 'info');
				return;
			}

			let selectedCountOnPage = 0;
			currentImagesOnPage.forEach(img => {
				if (selectedImageIds.size < 500) {
					selectedImageIds.add(img.id);
					selectedCountOnPage++;
				}
			});

			if (selectedCountOnPage < currentImagesOnPage.length) {
				showToast(`Selection limit of 500 reached. ${selectedCountOnPage} images from this page were added.`, 'info');
			}

			galleryGrid.querySelectorAll('.thumb').forEach(thumb => {
				const thumbId = parseInt(thumb.dataset.imageId, 10);
				if (selectedImageIds.has(thumbId)) {
					thumb.classList.add('selected');
				}
			});
			updateSelection();
		});

		document.getElementById('deselectAllBtn').addEventListener('click', () => {
			currentImagesOnPage.forEach(img => selectedImageIds.delete(img.id));
			galleryGrid.querySelectorAll('.thumb').forEach(thumb => thumb.classList.remove('selected'));
			updateSelection();
		});
		
		document.getElementById('clearAllBtn').addEventListener('click', async () => {
			if (selectedImageIds.size === 0) return;
			const confirmed = await showConfirmation("Are you sure you want to clear all selections?");
			if (confirmed) {
				selectedImageIds.clear();
				updateSelection();
				galleryGrid.querySelectorAll('.thumb.selected').forEach(thumb => thumb.classList.remove('selected'));
				showToast("All selections cleared.", 'info');
			}
		});

		document.getElementById('undoBtn').addEventListener('click', async () => {
			const confirmed = await showConfirmation("Are you sure you want to undo the last batch tag operation?");
			if (!confirmed) return;
			try {
				const response = await fetch("/api/images/batch_undo", { method: "POST" });
				const result = await response.json();
				if (response.ok) {
					showToast(result.message || 'Undo successful!', 'success');
					selectedImageIds.clear();
					updateSelection();
					galleryManager.reload(galleryManager.getCurrentPage());
				} else {
					showToast(result.detail || 'Undo failed.', 'error');
				}
			} catch (err) {
				showToast("An unexpected error occurred during undo.", 'error');
			}
		});

		// Listeners for the main action form.
		actionSelect.addEventListener('change', toggleTagInputVisibility);
		applyActionBtn.addEventListener('click', handleApplyAction);

        // Setup autocomplete
		setupTagAutocomplete(searchInput, suggestionsSearchBox, { showSavedSearches: true });
		setupTagAutocomplete(batchTagsInput, suggestionsBatchBox);
	}

	// --- 7. START THE APPLICATION ---
	initializeEventListeners();
    // Set initial UI state
    toggleTagInputVisibility();
    updateSelection();
});