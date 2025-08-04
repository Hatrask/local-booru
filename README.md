# local-booru

A simple, self-hosted image gallery (booru) with a focus on powerful tagging and a clean, single-user interface. This project is designed for individuals who want to organize their personal image collections locally with the privacy and control of self-hosting.

![Gallery Screenshot](https://i.ibb.co/KzXXbhrJ/2025-08-04-19-31.jpg)

![](https://i.ibb.co/nNwd88cc/2025-08-04-19-31-1.jpg)

## Features

*   **Simple Uploading:** Upload multiple images at once and assign initial tags to the whole batch.
*   **Powerful Tagging System:** A robust many-to-many relationship between images and tags. Edit tags on individual images or in bulk.
*   **Advanced Search:** Find exactly what you're looking for with a search syntax that supports:
    *   **AND** logic (`tag1, tag2`)
    *   **OR** logic (`(tag1 | tag2)`)
    *   **NOT** logic (`-tag3`)
    *   **Wildcards** (`art*`)
    *   A special `untagged` query to find images that need organizing.
*   **Interactive Gallery:**
    *   A clean, paginated view of your images.
    *   Adjustable thumbnail sizes (Small, Medium, Large) that are saved to your browser.
    *   A full-screen lightbox viewer with keyboard navigation (`A`/`D` or Arrow Keys).
*   **Batch Editing:** Select images across multiple pages to add, remove, or completely replace their tags in one go. You can also batch delete images.
*   **Persistent Undo:** Accidentally changed the tags on 100 images? A single click on the "Undo" button on the Batch Actions page will revert the last batch operation, even if you've restarted the server.
*   **Tag Management:** A dedicated page to clean up your tag list by renaming, merging duplicates (e.g., merge `cat` and `kitty`), or force-deleting tags entirely.

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

## File Structure

Your data is stored in the root directory of the project.

*   `database.db`: This is the SQLite database file containing all information about your images and tags. **Do not delete this file unless you want to start over.**
*   `media/images/`: All your uploaded image files are stored here.
*   `undo_state.json`: This file is created temporarily when you perform a batch action, allowing you to undo it. It is deleted automatically after a successful undo.

## Contributing

This is a personal project, but bug reports and feature requests are welcome! Please feel free to open an issue on the GitHub repository.

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.