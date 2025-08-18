import shutil
import os
import sys
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from fastapi.middleware.cors import CORSMiddleware

from .database import Base

# --- Path setup for PyInstaller ---
# This function is crucial for finding bundled assets (like static/templates) when packaged.
def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        # In a normal development environment, the base path is the project root.
        base_path = os.path.abspath(".")
    return os.path.join(base_path, relative_path)

# --- Path Configuration ---
if getattr(sys, 'frozen', False):
    # If the application is run as a bundle, the project root is where the executable is.
    PROJECT_ROOT = os.path.dirname(sys.executable)
else:
    # In development, __file__ is /app/__init__.py, so we go up one level to the project root.
    PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# --- Constants ---
MEDIA_DIR = os.path.join(PROJECT_ROOT, "media")
THUMBNAIL_DIR = os.path.join(MEDIA_DIR, "thumbnails")
DATABASE_URL = f"sqlite:///{os.path.join(PROJECT_ROOT, 'database.db')}"
UNDO_STATE_FILE = os.path.join(PROJECT_ROOT, "undo_state.json")
VALID_CATEGORIES = {"general", "artist", "character", "copyright", "metadata"}


# --- Reset Function ---
def check_and_perform_reset():
    """
    Checks for a `.reset_pending` flag file on startup. If found, it performs
    a factory reset and then removes the flag. This runs before the server starts.
    """
    reset_flag_file = os.path.join(PROJECT_ROOT, ".reset_pending")
    if not os.path.exists(reset_flag_file):
        return

    print("INFO:     '.reset_pending' flag found. Performing factory reset...")
    db_file = DATABASE_URL.replace("sqlite:///", "")
    images_dir = os.path.join(MEDIA_DIR, "images")
    thumbnails_dir = THUMBNAIL_DIR

    items_to_delete = [
        {"path": db_file, "type": "file"},
        {"path": UNDO_STATE_FILE, "type": "file"},
        {"path": images_dir, "type": "directory"},
        {"path": thumbnails_dir, "type": "directory"},
    ]

    for item in items_to_delete:
        path = item["path"]
        if os.path.exists(path):
            try:
                if item["type"] == "file":
                    os.remove(path)
                elif item["type"] == "directory":
                    shutil.rmtree(path)
                print(f"INFO:     - Deleted {path}")
            except OSError as e:
                print(f"ERROR:    Could not delete {path}. Reason: {e}")
    
    os.makedirs(images_dir, exist_ok=True)
    os.makedirs(thumbnails_dir, exist_ok=True)
    print("INFO:     - Recreated media directories.")
    
    os.remove(reset_flag_file)
    print("INFO:     Factory reset complete. Application will now start normally.")


# --- Application Initialization ---
check_and_perform_reset() # Factory reset call

app = FastAPI(
    title="local-booru",
    description="A self-hosted image gallery with advanced tagging.",
    version="3.4.0",
)

# --- Static File and Template Configuration ---
os.makedirs(os.path.join(MEDIA_DIR, "images"), exist_ok=True)
os.makedirs(THUMBNAIL_DIR, exist_ok=True)

STATIC_DIR = resource_path("app/static")
TEMPLATES_DIR = resource_path("app/templates")

app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
app.mount("/media/thumbnails", StaticFiles(directory=THUMBNAIL_DIR), name="thumbnails")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# --- CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Configuration (SQLite) ---
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base.metadata.create_all(bind=engine)

# --- Database Session Dependency ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Import routes after the app and db setup are complete
from . import routes