# local-booru

A simple, self-hosted image gallery (booru) with a focus on powerful tagging and a clean, single-user interface. This project is designed for individuals who want to organize their personal image collections locally with the privacy and control of self-hosting.

![Gallery Screenshot](https://i.ibb.co/KzXXbhrJ/2025-08-04-19-31.jpg)
![](https://i.ibb.co/nNwd88cc/2025-08-04-19-31-1.jpg)

## Features

*   **Duplicate File Prevention:** Calculates the SHA256 hash of each uploaded file to prevent adding duplicate images to your library.
*   **Categorized Tagging:** Organizes tags into five distinct categories (`general`, `artist`, `character`, `copyright`, `metadata`). Tags are color-coded in the UI for quick identification.
*   **Data Management UI:** Easily import and export your entire collection, or perform a factory reset, directly from the Settings page in the web interface.
*   **Tag-Based Search Syntax:** Find images using a dedicated query language that supports `AND`, `OR`, `NOT`, and `wildcard (*)` logic, along with a special `untagged` keyword.
*   **Saved & Recent Searches:** Automatically keeps a list of your recent queries. You can "pin" your most important searches for permanent access from the search bar.
*   **Image Gallery with Integrated Editor:** Browse your collection in a masonry-style grid. Clicking an image opens a two-state lightbox:
    *   **View Mode:** Navigate between images, view tags, and use keyboard shortcuts for browsing.
    *   **Edit Mode:** Switch to a side-panel view to edit an image's tags directly in the lightbox, with access to a helper panel for finding recent or existing tags.
*   **Batch Tagging & Deletion:** A dedicated page for performing actions on multiple images at once. Selections persist across pages, and you can add, remove, replace, or delete tags in bulk.
*   **Undo for Batch Operations:** Reverts the last batch *tagging* operation (add, remove, or replace). The undo state is saved to disk, so it persists even after an application restart.
*   **Tag Maintenance Tools:** A dedicated page for database-level tag operations, including renaming, merging, deleting, and changing the category of any tag.

## Getting Started

Follow these steps to get `local-booru` running on your local machine.

### Prerequisites

*   Python 3.7 or newer
*   `pip` (Python's package installer)

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/Hatrask/local-booru.git
    cd local-booru
    ```

2.  **(Recommended) Create a virtual environment:**
    ```bash
    # On Windows
    python -m venv venv
    venv\Scripts\activate
    
    # On macOS/Linux
    python3 -m venv venv
    source venv/bin/activate
    ```

3.  **Install the required packages:**
    ```bash
    pip install -r requirements.txt
    ```

4.  **Run the application:**
    ```bash
    python main.py
    ```
    The server will start. You should see output similar to this:
    ```
    INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
    ```

5.  **Open the application:**
    Open your web browser and navigate to **[http://127.0.0.1:8000](http://127.0.0.1:8000)**.

## How to Use

1.  **Upload:** Go to the "Upload" page to add your first images. You can add categorized tags directly on upload (e.g., `artist:someartist, character:somechar, tag1`).
2.  **Browse:** Navigate to the "Gallery" to see your collection. Press `T` to toggle the tag tooltips on and off.
3.  **Search:** Use the search bar to filter images. You can now search by category (e.g., `character:reimu_hakurei`).
4.  **View & Edit:** Click any image to open it in the lightbox. In **View Mode**, you can navigate between images. Press `E` to switch to **Edit Mode**, where a sidebar appears, allowing you to modify the image's tags. Press `S` to save your changes or `Esc` to cancel and return to view mode.
5.  **Organize:** Use the "Batch Actions" and "Tag Manager" pages for larger-scale organization.
6.  **Manage Data:** Visit the **Settings** page to import/export your collection or perform a factory reset.

## File Structure

Your data is stored in the root directory of the project.

*   `database.db`: The SQLite database file containing all image and tag information. It is automatically created and managed by the application.
*   `media/images/`: All your uploaded image files are stored here.
*	`media/images/thumbnails`: All the images will have a thumbnail stored in this directory to improve the performance of the application.
*   `undo_state.json`: This file is created temporarily when you perform a batch tag action, allowing you to undo it. It is deleted after a successful undo or overwritten by the next batch action.

**Note:** Saved searches and theme preferences are stored directly in your web browser's `localStorage` and are not part of the server-side file structure.

## Contributing

This is a personal project, but bug reports and feature requests are welcome! Please feel free to open an issue on the GitHub repository.

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.