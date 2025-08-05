# local-booru

A simple, self-hosted image gallery (booru) with a focus on powerful tagging and a clean, single-user interface. This project is designed for individuals who want to organize their personal image collections locally with the privacy and control of self-hosting.

![Gallery Screenshot](https://i.ibb.co/KzXXbhrJ/2025-08-04-19-31.jpg)
![](https://i.ibb.co/nNwd88cc/2025-08-04-19-31-1.jpg)

## Features

*   **Duplicate-Aware Uploads:** Upload multiple images at once. The system calculates a SHA256 hash for each file and automatically ignores any duplicates, ensuring a clean media library.
*   **Flexible Tagging:** The core of the application is built on a many-to-many relationship between images and tags. Tags can be managed individually or through powerful batch actions.
*   **Comprehensive Search:** A search bar with a dedicated query syntax supports finding images by a combination of tags. Includes support for:
    *   `AND` logic (`tag1, tag2`)
    *   `OR` logic (`(tag1 | tag2)`)
    *   `NOT` logic (`-tag3`)
    *   `Wildcard` matching (`art*`)
    *   A special `untagged` keyword.
*   **Gallery & Viewer:** A paginated thumbnail grid for browsing the collection. Thumbnail sizes are configurable (S/M/L) and saved in the browser. Includes a full-screen lightbox viewer with keyboard navigation for cycling through images.
*   **Batch Actions:** A dedicated page for modifying large sets of images at once. Selections are persistent across pages, allowing you to add, remove, or replace tags, or to permanently delete images in bulk.
*   **Persistent Undo:** Reverts the last batch *tagging* operation (add, remove, or replace). The undo state is saved to disk, so it persists even after restarting the application.
*   **Tag Management:** A dedicated page for database-level tag maintenance, essential for keeping a tag library clean and organized.
    *   Filter tags by name and view unused (orphan) tags.
    *   Sort tags alphabetically or by image count.
    *   Rename, merge, and force-delete tags.

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

1.  **Upload:** Go to the "Upload" page to add your first images.
2.  **Browse:** Navigate to the "Gallery" to see your collection.
3.  **Search:** Use the search bar at the top of the gallery to filter your images. Click the "Help" link for a full guide on the search syntax.
4.  **Edit:** Click any image to open the lightbox viewer. From there, click "Edit Tags" to go to the image's dedicated page where you can update its tags.
5.  **Organize:** Use the "Batch Actions" and "Tag Manager" pages for larger-scale organization.

## Maintenance

### Factory Reset

If you wish to completely erase all data and start over, a command-line script is provided. **This is a destructive, irreversible action.**

1.  **Stop the application server.** This is a critical step to prevent file-locking errors.
2.  Navigate to the project's root directory in your terminal.
3.  Run the script:
    ```bash
    python reset_application.py
    ```
4.  The script will ask for a final confirmation. Type `yes` to proceed.
5.  Once the script is finished, you can restart the application server for a fresh start.

### File Structure

Your data is stored in the root directory of the project.

*   `database.db`: The SQLite database file containing all image and tag information. It is automatically created and managed by the application.
*   `media/images/`: All your uploaded image files are stored here.
*   `undo_state.json`: This file is created temporarily when you perform a batch tag action, allowing you to undo it. It is deleted after a successful undo or overwritten by the next batch action.

## Contributing

This is a personal project, but bug reports and feature requests are welcome! Please feel free to open an issue on the GitHub repository.

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.