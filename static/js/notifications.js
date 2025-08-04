// static/js/notifications.js

/**
 * Displays a non-blocking toast notification.
 * @param {string} message - The message to display.
 * @param {string} type - 'success', 'error', or 'info'.
 */
function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    
    // Create the container if it doesn't exist
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // Add the toast to the container
    container.appendChild(toast);

    // Automatically remove the toast after 3 seconds
    setTimeout(() => {
        // Apply fade-out class
        toast.classList.add('fade-out');
        // Remove from DOM after transition completes
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000);
}

// Function to handle browser-native confirmations (optional, but good practice)
function showConfirmation(message) {
    return new Promise((resolve) => {
        if (confirm(message)) {
            resolve(true);
        } else {
            resolve(false);
        }
    });
}