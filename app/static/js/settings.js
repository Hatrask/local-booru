/**
 * settings.js
 *
 * This file handles all client-side logic for the settings page (`settings.html`).
 * This includes managing the theme (dark/light mode), handling the file import
 * process, and managing the factory reset functionality.
 */
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. DOM ELEMENT REFERENCES ---
    const themeToggle = document.getElementById('theme-toggle');
    const factoryResetBtn = document.getElementById('factory-reset-btn');
    const importForm = document.getElementById('import-form');
    const importFileInput = document.getElementById('import-file-input');
    const importLabel = document.getElementById('import-label');

    // --- 2. EVENT HANDLERS & LOGIC ---

    /**
     * Handles the theme toggle switch interaction.
     */
    function handleThemeToggle() {
        const newTheme = themeToggle.checked ? 'dark' : 'light';
        // Set the attribute on the root <html> element for CSS to work
        document.documentElement.setAttribute('data-theme', newTheme);
        // Persist the user's choice in localStorage
        localStorage.setItem('localBooruTheme', newTheme);
    }

    /**
     * Handles the file import process when a user selects a file.
     */
    async function handleImport() {
        const file = importFileInput.files[0];
        if (!file) {
            return;
        }

        const originalLabelText = importLabel.textContent;
        importLabel.textContent = 'Importing...';
        importFileInput.disabled = true;

        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/import_collection', {
                method: 'POST',
                body: formData,
            });
            
            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.detail || 'An unknown error occurred during import.');
            }
            
            // showToast is imported from notifications.js
            showToast(result.message, 'success');

        } catch (error) {
            showToast(`Error: ${error.message}`, 'error');
        } finally {
            // Reset the form and button regardless of outcome
            importLabel.textContent = originalLabelText;
            importFileInput.disabled = false;
            importForm.reset();
        }
    }

    /**
     * Handles the factory reset button interaction.
     */
    async function handleFactoryReset() {
        const confirmationText = 'reset my booru';
        const promptMessage = `This will permanently delete everything on the NEXT RESTART. This action cannot be undone.\n\nPlease type '${confirmationText}' to confirm.`;
        const userInput = prompt(promptMessage);

        if (userInput !== confirmationText) {
            showToast('Factory reset cancelled.', 'info');
            return;
        }

        try {
            factoryResetBtn.disabled = true;
            factoryResetBtn.textContent = 'Scheduling...';
            const response = await fetch('/api/factory_reset', { method: 'POST' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.detail);

            // Factory reset is scheduled, now clear client-side storage too.
            localStorage.clear();

            showToast(result.message, 'success');
            factoryResetBtn.textContent = 'Restart Pending';
        } catch (error) {
            showToast(`Error: ${error.message}`, 'error');
            factoryResetBtn.disabled = false;
            factoryResetBtn.textContent = 'Reset Application';
        }
    }

    // --- 3. INITIALIZATION ---

    /**
     * Sets up the initial state and attaches all event listeners.
     */
    function initialize() {
        // Set the initial state of the theme toggle based on localStorage.
        const currentTheme = localStorage.getItem('localBooruTheme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        themeToggle.checked = currentTheme === 'dark';
        
        // Attach event listeners
        themeToggle.addEventListener('change', handleThemeToggle);
        importFileInput.addEventListener('change', handleImport);
        factoryResetBtn.addEventListener('click', handleFactoryReset);
    }

    initialize();
});