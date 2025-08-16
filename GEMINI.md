
# GEMINI.md

## Project Overview

This project is a self-hosted image gallery (booru) built with Python and FastAPI. It provides a web interface for uploading, tagging, and searching images. The backend is a FastAPI application, and the frontend is built with Jinja2 templates and vanilla JavaScript. The data is stored in a SQLite database, and the application uses SQLAlchemy as its ORM.

The application is designed to be run either directly from the source code or as a packaged executable using PyInstaller.

### Key Technologies

*   **Backend:** Python, FastAPI, Uvicorn
*   **Database:** SQLite, SQLAlchemy
*   **Frontend:** Jinja2, HTML, CSS, JavaScript
*   **Image Processing:** Pillow
*   **Dependencies:** `fastapi`, `uvicorn`, `sqlalchemy`, `jinja2`, `python-multipart`, `pydantic`, `tqdm`, `Pillow`

### Architecture

The application follows a standard web application architecture:

*   `main.py`: The entry point of the application, responsible for running the Uvicorn server.
*   `app/__init__.py`: Initializes the FastAPI application, database, and other configurations.
*   `app/routes.py`: Defines all the API endpoints and serves the HTML pages.
*   `app/database.py`: Defines the SQLAlchemy database models.
*   `app/utils.py`: Contains utility functions used throughout the application.
*   `app/static/`: Contains the static assets (CSS, JavaScript, images).
*   `app/templates/`: Contains the Jinja2 templates for the HTML pages.
*   `media/`: Contains the uploaded images and thumbnails.
*   `database.db`: The SQLite database file.

## Building and Running

### Running from Source

1.  **Install Dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

2.  **Run the Application:**
    ```bash
    python main.py
    ```

The application will be available at `http://127.0.0.1:8000`.

### Building the Executable

The project can be packaged into a single executable using PyInstaller. The `local-booru.spec` file is used for this purpose.

## Development Conventions

*   **Coding Style:** The code follows standard Python conventions (PEP 8).
*   **Tagging:** The application uses a categorized tagging system (`general`, `artist`, `character`, `copyright`, `metadata`).
*   **API:** The application provides a RESTful API for managing images and tags.
*   **Database:** The database schema is defined in `app/database.py`. Migrations are not used; the schema is created directly from the models.
*   **Frontend:** The frontend is built with Jinja2 templates and vanilla JavaScript. There is no complex frontend framework in use.
