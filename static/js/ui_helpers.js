/**
 * ui_helpers.js
 *
 * This file contains globally useful helper functions for the UI,
 * primarily related to tag parsing and styling. It helps to keep
 * common logic in one place.
 */

const VALID_CATEGORIES = ["general", "artist", "character", "copyright", "metadata"];

/**
 * Parses a raw tag string (e.g., "artist:name") into its constituent parts.
 * This is robust enough to handle colons in the tag name itself.
 *
 * @param {string} rawTag The raw tag string to parse.
 * @returns {{name: string, category: string}} An object with the tag's name and category.
 */
function parseTag(rawTag) {
    const parts = rawTag.split(':');
    const potentialCategory = parts[0];
    
    if (parts.length > 1 && VALID_CATEGORIES.includes(potentialCategory)) {
        // A valid category prefix was found.
        return {
            category: potentialCategory,
            name: parts.slice(1).join(':') // Re-join the rest in case name has colons.
        };
    }
    
    // If no valid prefix is found, it defaults to the 'general' category.
    return { name: rawTag, category: 'general' };
}

/**
 * Returns the appropriate CSS class for a given tag category for color-coding.
 *
 * @param {string} category The category of the tag.
 * @returns {string} The CSS class name.
 */
function getTagCategoryClass(category) {
    if (VALID_CATEGORIES.includes(category)) {
        return `tag-${category}`;
    }
    return 'tag-general';
}

/**
 * Generates the HTML for a set of color-coded, clickable tag pills.
 * Can create either static links or editable pills with remove buttons.
 * @param {Array<Object>} tags - An array of tag objects [{name, category}].
 * @param {boolean} [isEditable=false] - If true, renders editable pills with remove buttons.
 * @returns {string} The HTML string for the tag pills.
 */
function renderTagPills(tags, isEditable = false) {
    if (!tags || tags.length === 0) {
        // Provide a default for non-editable contexts, and nothing for editable ones.
        return !isEditable ? '<a href="?q=untagged" class="tag-name-link tag-pill tag-metadata">untagged</a>' : '';
    }
    return tags.map(tag => {
        const categoryClass = getTagCategoryClass(tag.category);
        const rawTagName = tag.category === 'general' ? tag.name : `${tag.category}:${tag.name}`;
        
        if (isEditable) {
             return `<span class="tag-pill ${categoryClass}" data-tag="${rawTagName}">${tag.name}<button class="remove-tag-btn">×</button></span>`;
        } else {
            const searchLink = `?q=${encodeURIComponent(rawTagName)}`;
            // The data-tag attribute is added here to allow CSS to style special tags like 'favorite'.
            return `<a href="${searchLink}" class="tag-pill ${categoryClass}" data-tag="${rawTagName}">${tag.name}</a>`;
        }
    }).join('');
}

/**
 * Toggles the mobile navigation menu.
 * Finds the toggle button and the navigation menu by their IDs,
 * and adds a click event listener to toggle the 'active' class on both.
 * This allows CSS to control the visibility and styling of the mobile menu.
 */
function setupMobileNavigation() {
    const navToggle = document.getElementById('mobile-nav-toggle');
    const mainNav = document.getElementById('main-nav');

    if (navToggle && mainNav) {
        navToggle.addEventListener('click', () => {
            // Toggle visibility of the navigation menu
            mainNav.classList.toggle('active');
            // Animate the hamburger icon (e.g., to an 'X')
            navToggle.classList.toggle('active');
            // Prevent the body from scrolling when the menu is open
            document.body.classList.toggle('no-scroll');
        });
    }
}

// --- Main Event Listener ---
// Ensures the DOM is fully loaded before our scripts run.
document.addEventListener('DOMContentLoaded', () => {
    setupMobileNavigation();
});