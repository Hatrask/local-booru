/**
 * notifications.js
 *
 * This utility file provides reusable functions for displaying user feedback,
 * including non-blocking "toast" notifications and Promise-based confirmation dialogs.
 */

/**
 * Displays a temporary, non-blocking toast notification at the bottom-right of the screen.
 *
 * @param {string} message The message to display inside the toast.
 * @param {string} [type='info'] The type of toast, which determines its color.
 *                               Accepts 'success', 'error', or 'info'.
 */
function showToast(message, type = 'info') {
    // Find the toast container, or create it dynamically if it doesn't exist.
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }

    // Create the new toast element.
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    // Add the toast to the page.
    container.appendChild(toast);

    // Set a timer to automatically remove the toast.
    setTimeout(() => {
        // First, apply the fade-out animation class.
        toast.classList.add('fade-out');
        
        // After the CSS transition finishes, remove the element from the DOM completely.
        toast.addEventListener('transitionend', () => toast.remove());
    }, 3000); // The toast will be visible for 3 seconds.
}

/**
 * Displays a native browser confirmation dialog and returns the result as a Promise.
 * This allows for using async/await to handle user confirmation cleanly.
 *
 * Example: if (await showConfirmation("Are you sure?")) { ... }
 *
 * @param {string} message The confirmation message to display to the user.
 * @returns {Promise<boolean>} A Promise that resolves to `true` if the user clicks "OK",
 *                             and `false` if they click "Cancel".
 */
function showConfirmation(message) {
    return new Promise(resolve => {
        // The confirm() function directly returns true or false.
        resolve(confirm(message));
    });
}