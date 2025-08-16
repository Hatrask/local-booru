# local-booru

A simple, self-hosted image gallery (booru) with a focus on powerful tagging and a clean, single-user web interface. I made this because I wasn't happy with the existing solutions. It probably won't, ever, be as powerful as something like hydrus or Danbooru, but I will try my best to build something nice.

Please note that this program is in a very early stage of development and shouldn't be used to replace existing solutions.

![Project Screenshots](https://github.com/user-attachments/assets/44dcc9b8-7ea0-4cb0-8f8b-cbe6502909c9)

## Features

*   **Categorized Tagging:** Create and organize tags into five distinct categories (`general`, `artist`, `character`, `copyright`, `metadata`). Tags are color-coded in the UI for quick identification.
*   **Tag-Based Search Syntax:** Find images using a dedicated query language that supports `AND`, `OR`, `NOT`, and `wildcard (*)` logic, along with special keywords like `untagged`.
*   **Image Gallery with Viewer:** Shows your collection in a masonry-style grid. Clicking an image opens a lightbox with two modes:
    *   **View Mode:** Navigate with shortcuts, view tags, favorite or delete images, or
    *   **Edit Mode:** Switch to a side-panel view to edit image's tags directly from the lightbox, with recently used tags listed and a search bar.
*   **Batch Tagging & Deletion:** A dedicated page for performing actions on multiple tags and images at once. Selections persist across pages.
*   **Tag Maintenance Tools:** A dedicated page for database-level tag operations, including renaming, merging, deleting, and changing the category of any tag.
*   **Saved & Recent Searches:** Automatically keeps a list of your recent queries. You can "pin" your most important searches here too.
*   **Data Management:** Import and export your entire collection, or reset the application, directly from the Settings page in the web interface.

## Getting Started

Follow these steps to get `local-booru` running on your machine.

### Installation for Windows (Recommended)

For Windows users, the easiest way to get started is by using the pre-built application available on the project's releases page.

1.  **Download the latest release:**
    *   Go to the **[Releases Tab](https://github.com/Hatrask/local-booru/releases)** on GitHub.
    *   Download the latest `.zip` file for Windows.

2.  **Extract the application:**
    *   Unzip the downloaded file to a folder of your choice.

3.  **Run the application:**
    *   Open the extracted folder and double-click the `local-booru.exe` executable file.
    *   The server will start in a command-line prompt.

4.  **Open the application:**
    *   Open your web browser and navigate to **[http://127.0.0.1:8000](http://127.0.0.1:8000)**.

### Manual Installation (All Platforms)

This method is for macOS, Linux, and Windows users who prefer to run the application from the source code.

#### Prerequisites

*   Python 3.11 or newer
*   `pip` (Python's package installer)

#### Instructions

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
    ```bash
    INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
    ```

5.  **Open the application:**
    Open your web browser and navigate to **[http://127.0.0.1:8000](http://127.0.0.1:8000)**.

## How to Use

1.  **Upload:** Go to the "Upload" page to add your first images. You can tag images directly while uploading (e.g., `artist:someartist, character:somechar, tag1`).
2.  **Browse:** Navigate to the "Gallery" to see your collection. Press `T` to toggle tooltips on and off.
3.  **Search:** Use the search bar to filter images. Refer to the help page for detailed information on the search syntax.
4.  **View & Edit:** Click any image to open it in the lightbox. Press `E` to quickly switch to **Edit Mode** and start tagging your collection.
5.  **Organize:** Use the "Batch Actions" and "Tag Manager" pages for large-scale organization.
6.  **Manage Data:** Visit the **Settings** page to import/export your collection, or wipe all your data.

## File Structure

Your data is stored in the root directory of the project.

*   `database.db`: The SQLite database file containing all image and tag information. It is automatically created and managed by the application.
*   `media/images/`: All your uploaded image files are stored here.
*	`media/thumbnails/`: All the generated thumbnails are stored here.
*   `undo_state.json`: This file is created temporarily when you perform a batch tag action, allowing you to undo it. It is deleted after a successful undo or overwritten by the next batch action.

**Note:** Saved searches and theme preferences are stored directly in your web browser's `localStorage` and won't be wiped by the factory reset function from Settings. You have to do it manually.

## Contributing

This is a personal project, but bug reports and feature requests are welcome! Please feel free to open an issue on the GitHub repository.

## License

This project is licensed under the MIT License - see the `LICENSE` file for details.