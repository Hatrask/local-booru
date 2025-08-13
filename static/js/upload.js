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
    const MAX_FILES = 500;
    let queuedFiles = [];
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
            uploadButton.textContent = 'Uploading...';
        } else {
            uploadButton.disabled = !hasFiles;
            uploadButton.textContent = 'Upload';
        }
    }

    /**
     * Generates and appends a preview thumbnail for a given file.
     * @param {File} file The file to create a preview for.
     */
    function createAndAppendPreview(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'preview-thumb-wrapper';
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
            const img = document.createElement('img');
            img.src = e.target.result;
            img.className = 'preview-thumb';
            wrapper.appendChild(img);
            wrapper.appendChild(removeBtn);
            previewContainer.appendChild(wrapper);
        };
        reader.readAsDataURL(file);
    }

    /**
     * Clears the file queue and resets all related UI elements to their initial state.
     */
    function clearQueue() {
        queuedFiles = [];
        previewContainer.innerHTML = '';
        uploadForm.reset();
        // Explicitly clear file input values to allow re-selecting the same items.
        fileInput.value = '';
        folderInput.value = '';
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
            // Adds a single valid image file to the queue if the limit has not been reached.
            const addFileToQueue = (file) => {
                if (queuedFiles.length >= MAX_FILES) {
                    fileLimitBreached = true;
                    return false; // Signal to stop processing
                }
                // Add if it's an image and not already a duplicate in the queue
                if (file.type.startsWith('image/') && !queuedFiles.some(f => f.name === file.name && f.size === file.size)) {
                    queuedFiles.push(file);
                    createAndAppendPreview(file);
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
                        if (innerEntry.isDirectory) {
                            await traverseDirectory(innerEntry);
                        } else if (innerEntry.isFile) {
                            try {
                                const file = await new Promise((res, rej) => innerEntry.file(res, rej));
                                addFileToQueue(file);
                            } catch (err) { console.warn("Could not read file:", innerEntry.name, err); }
                        }
                    }
                } while (entries.length > 0 && !fileLimitBreached);
            };

            // Loop through all items provided by the input or drop event.
            for (const item of (items instanceof DataTransferItemList ? Array.from(items) : Array.from(items))) {
                if (fileLimitBreached) break;
                const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
                
                if (entry?.isDirectory) {
                    await traverseDirectory(entry);
                } else if (entry?.isFile) {
                    const file = await new Promise((res, rej) => entry.file(res, rej));
                    addFileToQueue(file);
                } else if (item instanceof File) {
                    addFileToQueue(item);
                }
            }
        } catch (error) {
            console.error("Error processing files:", error);
            showToast("An error occurred while processing items.", "error");
        } finally {
            // This block is crucial. It guarantees the processing state is reset
            // and the UI is updated, even if errors occurred.
            isProcessingFiles = false;
            if (fileLimitBreached) {
                showToast(`File limit of ${MAX_FILES} reached. Some files were not added.`, 'info');
            }
            updateUIVisuals();
        }
    }

    /**
     * Handles the form submission by building FormData from the queue and POSTing it.
     * @param {SubmitEvent} event The form's submit event.
     */
    async function handleFormSubmit(event) {
        event.preventDefault();
        if (isUploading || isProcessingFiles || queuedFiles.length === 0) {
            if (queuedFiles.length === 0) showToast('Please select some files to upload.', 'info');
            return;
        }
        isUploading = true;
        uploadStatusDiv.textContent = `Uploading ${queuedFiles.length} file(s)...`;
        uploadStatusDiv.style.color = 'var(--color-text-primary)';
        updateUIVisuals();

        const formData = new FormData();
        formData.append('tags', tagInput.value);
        queuedFiles.forEach(file => formData.append('files', file));

        try {
            const response = await fetch('/upload', { method: 'POST', body: formData });
            const result = await response.json();
            if (response.ok) {
                uploadStatusDiv.textContent = result.message || 'Upload successful.';
                uploadStatusDiv.style.color = 'var(--color-success)';
                clearQueue();
            } else {
                uploadStatusDiv.textContent = `Upload failed: ${result.detail || result.message || `Server responded with status ${response.status}.`}`;
                uploadStatusDiv.style.color = 'var(--color-danger)';
            }
        } catch (error) {
            console.error('Error during upload:', error);
            uploadStatusDiv.textContent = 'An unexpected network error occurred.';
            uploadStatusDiv.style.color = 'var(--color-danger)';
        } finally {
            // Guarantees the upload state is reset, enabling the user to perform another upload.
            isUploading = false;
            updateUIVisuals();
        }
    }

    // --- 5. INITIALIZATION ---

    /**
     * Sets up all initial event listeners for the page.
     */
    function initialize() {
        // This function is expected to be defined in `autocomplete.js`
        setupTagAutocomplete(tagInput, suggestionsBox);

        // Wire up the user-facing links to trigger the hidden file/folder inputs.
        selectFilesLink.addEventListener('click', (e) => { e.preventDefault(); fileInput.click(); });
        selectFolderLink.addEventListener('click', (e) => { e.preventDefault(); folderInput.click(); });
        
        // Add change listeners to both hidden inputs. We reset the value after processing
        // to ensure the 'change' event fires even if the same file/folder is selected again.
        fileInput.addEventListener('change', (e) => { processItems(e.target.files); e.target.value = null; });
        folderInput.addEventListener('change', (e) => { processItems(e.target.files); e.target.value = null; });
        
        uploadForm.addEventListener('submit', handleFormSubmit);
        clearQueueBtn.addEventListener('click', clearQueue);

        // Setup drag and drop listeners on the main drop zone.
        dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('drag-over'); });
        dropZone.addEventListener('dragleave', (e) => { e.preventDefault(); dropZone.classList.remove('drag-over'); });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.items) {
                processItems(e.dataTransfer.items);
            }
        });

        updateUIVisuals(); // Set the initial state of the buttons.
    }

    initialize();
});