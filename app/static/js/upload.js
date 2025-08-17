/**
 * upload.js
 *
 * This file manages the client-side logic for the upload page (`upload.html`).
 * It handles file selection via drag-and-drop or file inputs, manages the
 * upload queue, generates image previews, and submits the files and associated
 * tags to the server.
 */
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. DOM ELEMENT REFERENCES ---
    const uploadForm = document.getElementById('uploadForm');
    const fileInput = document.getElementById('file-input');
    const folderInput = document.getElementById('folder-input');
    const selectFilesLink = document.getElementById('select-files-link');
    const selectFolderLink = document.getElementById('select-folder-link');
    const dropZone = document.getElementById('drop-zone');
    const previewContainer = document.getElementById('preview-container');
    const tagInput = document.getElementById('tagInput');
    const suggestionsBox = document.querySelector('.suggestions');
    const uploadStatusDiv = document.getElementById('upload-status');
    const uploadButton = document.getElementById('upload-button');
    const queueControls = document.getElementById('queue-controls');
    const fileCountSpan = document.getElementById('file-count');
    const clearQueueBtn = document.getElementById('clear-queue-btn');

    // --- 2. CONFIGURATION & STATE ---
    const MAX_FILES = 5000;
    const UPLOAD_CHUNK_SIZE = 50; // Upload 50 files at a time
    const CHUNK_UPLOAD_TIMEOUT = 60000; // 60 seconds timeout for each chunk
    const PREVIEW_MODE_THRESHOLD = 100; // Switch to list view above this number of files
    const THUMBNAIL_SIZE = 200;
    let queuedFiles = [];
    let currentPreviewMode = 'thumbnails'; // Can be 'thumbnails' or 'list'

    // State flags prevent concurrent operations (e.g., adding files while an upload is in progress)
    let isProcessingFiles = false;
    let isUploading = false;

    // --- 3. UI LOGIC ---

    /**
     * The single source of truth for all UI state changes. This function reads the current
     * state flags and queue length to ensure the UI is always consistent.
     */
    function updateUIVisuals() {
        const hasFiles = queuedFiles.length > 0;
        fileCountSpan.textContent = queuedFiles.length;
        queueControls.style.display = hasFiles || isProcessingFiles ? 'flex' : 'none';

        if (isProcessingFiles) {
            uploadButton.disabled = true;
            uploadButton.textContent = 'Processing...';
        } else if (isUploading) {
            uploadButton.disabled = true;
            // The button text is now handled inside handleFormSubmit to show progress
        } else {
            uploadButton.disabled = !hasFiles;
            uploadButton.textContent = 'Upload';
        }
    }

    /**
     * Switches the preview area to a simple list of filenames.
     */
    function switchToListView() {
        currentPreviewMode = 'list';
        previewContainer.innerHTML = ''; // Clear existing thumbnails
        previewContainer.classList.add('list-view'); // Add a class for styling

        queuedFiles.forEach(file => {
            const listItem = document.createElement('div');
            listItem.className = 'preview-list-item';
            listItem.textContent = file.name;
            previewContainer.appendChild(listItem);
        });
    }

    /**
     * Appends a new file to the preview area, either as a thumbnail or a list item.
     * @param {File} file The file to create a preview for.
     */
    async function createAndAppendPreview(file) {
        if (currentPreviewMode === 'thumbnails') {
            await createAndAppendThumbnail(file);
        } else {
            createAndAppendListItem(file);
        }
    }

    /**
     * Creates and appends a thumbnail preview for a given file.
     * @param {File} file The file to create a thumbnail for.
     */
    async function createAndAppendThumbnail(file) {
        const wrapper = document.createElement('div');
        wrapper.className = 'preview-thumb-wrapper';

        const thumbImg = document.createElement('img');
        thumbImg.className = 'preview-thumb';

        try {
            const thumbnailUrl = await generateThumbnail(file);
            thumbImg.src = thumbnailUrl;
        } catch (error) {
            console.error("Could not generate thumbnail for", file.name, error);
            thumbImg.src = '';
            thumbImg.alt = 'Preview not available';
        }

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'preview-remove-btn';
        removeBtn.innerHTML = '&times;';
        removeBtn.title = 'Remove ' + file.name;
        removeBtn.onclick = () => {
            wrapper.remove();
            queuedFiles = queuedFiles.filter(f => f !== file);
            updateUIVisuals();
        };

        wrapper.appendChild(thumbImg);
        wrapper.appendChild(removeBtn);
        previewContainer.appendChild(wrapper);
    }

    /**
     * Creates and appends a simple list item for a given file.
     * @param {File} file The file to create a list item for.
     */
    function createAndAppendListItem(file) {
        const listItem = document.createElement('div');
        listItem.className = 'preview-list-item';
        listItem.textContent = file.name;
        previewContainer.appendChild(listItem);
    }
    
    /**
     * Helper function to generate a thumbnail using a canvas.
     * @param {File} file - The image file.
     * @returns {Promise<string>} A promise that resolves with a Data URL of the thumbnail.
     */
    function generateThumbnail(file) {
        return new Promise((resolve, reject) => {
            const objectUrl = URL.createObjectURL(file);
            const img = new Image();
    
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
    
                let width = img.width;
                let height = img.height;
    
                if (width > height) {
                    if (width > THUMBNAIL_SIZE) {
                        height *= THUMBNAIL_SIZE / width;
                        width = THUMBNAIL_SIZE;
                    }
                } else {
                    if (height > THUMBNAIL_SIZE) {
                        width *= THUMBNAIL_SIZE / height;
                        height = THUMBNAIL_SIZE;
                    }
                }
    
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
    
                // Get the thumbnail as a JPEG Data URL. It's much smaller than PNG.
                const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
                
                // CRITICAL: Revoke the object URL for the large image immediately 
                // after generating the thumbnail to free up memory.
                URL.revokeObjectURL(objectUrl);
                resolve(dataUrl);
            };
    
            img.onerror = (err) => {
                URL.revokeObjectURL(objectUrl);
                reject(err);
            };
    
            img.src = objectUrl;
        });
    }

    /**
     * Clears the file queue and resets all related UI elements to their initial state.
     */
    function clearQueue() {
        queuedFiles = [];
        previewContainer.innerHTML = '';
        uploadForm.reset();
        fileInput.value = '';
        folderInput.value = '';
        
        // Reset preview mode
        currentPreviewMode = 'thumbnails';
        previewContainer.classList.remove('list-view');

        updateUIVisuals();
    }

    // --- 4. CORE LOGIC (File Processing & Uploading) ---

	/**
	 * Asynchronously processes files from user input or drag-and-drop. It handles
	 * individual files, multiple files, and recursively traverses directories.
	 * @param {FileList | DataTransferItemList} items The list of items to process.
	 */
	async function processItems(items) {
		if (isProcessingFiles || isUploading) return;
		isProcessingFiles = true;
		updateUIVisuals();
		let fileLimitBreached = false;

		try {
            const potentialTotal = queuedFiles.length + items.length; // Approximate, but good enough
            if (potentialTotal >= PREVIEW_MODE_THRESHOLD && currentPreviewMode === 'thumbnails') {
                switchToListView();
            }

			// Adds a single valid image file to the queue if the limit has not been reached.
			const addFileToQueue = async (file) => {
				if (queuedFiles.length >= MAX_FILES) {
					fileLimitBreached = true;
					return false; // Signal to stop processing
				}
				if (file.type.startsWith('image/') && !queuedFiles.some(f => f.name === file.name && f.size === file.size)) {
					queuedFiles.push(file);
                    await createAndAppendPreview(file);
				}
				return true; // Signal to continue
			};

			// Recursively reads entries from a directory, handling the paginated nature of the API.
			const traverseDirectory = async (entry) => {
				if (fileLimitBreached) return;
				const reader = entry.createReader();
				let entries;
				do {
					entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
					for (const innerEntry of entries) {
						if (queuedFiles.length >= MAX_FILES) {
							fileLimitBreached = true;
							break;
						}
                        if (queuedFiles.length >= PREVIEW_MODE_THRESHOLD && currentPreviewMode === 'thumbnails') {
                            switchToListView();
                        }
						if (innerEntry.isDirectory) {
							await traverseDirectory(innerEntry);
						} else if (innerEntry.isFile) {
							try {
								const file = await new Promise((res, rej) => innerEntry.file(res, rej));
								await addFileToQueue(file); // Await here
							} catch (err) { console.warn("Could not read file:", innerEntry.name, err); }
						}
					}
				} while (entries.length > 0 && !fileLimitBreached);
			};

			// The DataTransferItemList from a drop event becomes invalid after the first `await`.
			// We must synchronously extract all file/directory entries into a stable array
			// *before* starting any asynchronous processing.
			const itemsToProcess = [];
			if (items instanceof DataTransferItemList) {
				for (const item of items) {
					// item.webkitGetAsEntry() is a synchronous call.
					const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
					if (entry) {
						itemsToProcess.push(entry);
					}
				}
			} else {
				// A FileList from an <input> is already a stable list.
				itemsToProcess.push(...Array.from(items));
			}

			// Now, asynchronously loop over the stable `itemsToProcess` array.
			for (const itemOrEntry of itemsToProcess) {
				if (fileLimitBreached) break;

				if (itemOrEntry.isDirectory) {
					await traverseDirectory(itemOrEntry);
				} else if (itemOrEntry.isFile) {
					const file = await new Promise((res, rej) => itemOrEntry.file(res, rej));
					await addFileToQueue(file);
				} else if (itemOrEntry instanceof File) {
					await addFileToQueue(itemOrEntry);
				}
			}

		} catch (error) {
			console.error("Error processing files:", error);
			showToast("An error occurred while processing items.", "error");
		} finally {
			isProcessingFiles = false;
			if (fileLimitBreached) {
				showToast(`File limit of ${MAX_FILES} reached. Some files were not added.`, 'info');
			}
			updateUIVisuals();
		}
	}

    /**
     * Handles the form submission by uploading the queue in manageable chunks.
     * @param {SubmitEvent} event The form's submit event.
     */
    async function handleFormSubmit(event) {
        event.preventDefault();
        if (isUploading || isProcessingFiles || queuedFiles.length === 0) {
            if (queuedFiles.length === 0) showToast('Please select some files to upload.', 'info');
            return;
        }

        isUploading = true;
        updateUIVisuals();
        uploadStatusDiv.textContent = ''; // Clear previous status messages

        const totalFiles = queuedFiles.length;
        let uploadedCount = 0;
        let failedCount = 0;
        const originalButtonText = uploadButton.textContent;

        // Process the queue in chunks
        for (let i = 0; i < totalFiles; i += UPLOAD_CHUNK_SIZE) {
            const chunk = queuedFiles.slice(i, i + UPLOAD_CHUNK_SIZE);
            const chunkNumber = (i / UPLOAD_CHUNK_SIZE) + 1;
            const totalChunks = Math.ceil(totalFiles / UPLOAD_CHUNK_SIZE);

            uploadButton.textContent = `Uploading... ${Math.round((i / totalFiles) * 100)}%`;

            const formData = new FormData();
            formData.append('tags', tagInput.value);
            chunk.forEach(file => formData.append('files', file));

            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
                console.error(`Chunk ${chunkNumber} timed out.`);
            }, CHUNK_UPLOAD_TIMEOUT);

            try {
                const response = await fetch('/upload', {
                    method: 'POST',
                    body: formData,
                    signal: controller.signal
                });

                clearTimeout(timeoutId);

                const result = await response.json();
                if (response.ok) {
                    uploadedCount += result.uploaded_count || 0;
                    failedCount += result.failed_count || 0;
                } else {
                    failedCount += chunk.length;
                    console.error(`Chunk ${chunkNumber} failed:`, result.detail || result.message);
                }
            } catch (error) {
                clearTimeout(timeoutId);
                failedCount += chunk.length;
                if (error.name === 'AbortError') {
                    showToast(`Chunk ${chunkNumber} of ${totalChunks} timed out.`, 'error');
                } else {
                    showToast(`An error occurred with chunk ${chunkNumber}.`, 'error');
                    console.error(`Error during chunk ${chunkNumber} upload:`, error);
                }
            }
        }

        let finalMessage = `Upload complete. Succeeded: ${uploadedCount}, Failed: ${failedCount}.`;
        uploadStatusDiv.style.color = failedCount > 0 ? 'var(--color-danger)' : 'var(--color-success)';
        uploadStatusDiv.textContent = finalMessage;

        isUploading = false;
        clearQueue();
        uploadButton.textContent = originalButtonText;
        updateUIVisuals();
    }

    // --- 5. INITIALIZATION ---

    /**
     * Sets up all initial event listeners for the page.
     */
    function initialize() {
        // This function is expected to be defined in `autocomplete.js`
        setupTagAutocomplete(tagInput, suggestionsBox);

        selectFilesLink.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
        selectFolderLink.addEventListener('click', (e) => { e.preventDefault(); folderInput.click(); });
        
        fileInput.addEventListener('change', (e) => { processItems(e.target.files); e.target.value = null; });
        folderInput.addEventListener('change', (e) => { processItems(e.target.files); e.target.value = null; });
        
        uploadForm.addEventListener('submit', handleFormSubmit);
        clearQueueBtn.addEventListener('click', clearQueue);

        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.items) {
                processItems(e.dataTransfer.items);
            }
        });

        updateUIVisuals();
    }

    initialize();
});