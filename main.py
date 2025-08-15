import shutil, os, uuid, json, hashlib, sqlite3, io, zipfile, tempfile, sys
from datetime import datetime, timezone
from fastapi import FastAPI, UploadFile, File, Form, Request, Depends, Query, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import Column, Integer, String, Table, ForeignKey, create_engine, desc, orm, func, or_, and_, UniqueConstraint, DateTime
from sqlalchemy.orm import relationship, sessionmaker, declarative_base, Session
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict, IO
from PIL import Image as PILImage

# --- Path setup for PyInstaller ---
if getattr(sys, 'frozen', False):
    # If the application is run as a bundle, the PyInstaller bootloader
    # extends the sys module by a flag frozen=True and sets the app 
    # path into variable _MEIPASS'.
    application_path = os.path.dirname(sys.executable)
else:
    application_path = os.path.dirname(os.path.abspath(__file__))

def resource_path(relative_path):
    """ Get absolute path to resource, works for dev and for PyInstaller """
    try:
        # PyInstaller creates a temp folder and stores path in _MEIPASS
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)

# --- Constants ---
MEDIA_DIR = os.path.join(application_path, "media")
THUMBNAIL_DIR = os.path.join(MEDIA_DIR, "thumbnails")
DATABASE_URL = f"sqlite:///{os.path.join(application_path, 'database.db')}"
UNDO_STATE_FILE = os.path.join(application_path, "undo_state.json")
VALID_CATEGORIES = {"general", "artist", "character", "copyright", "metadata"}

# --- Reset Function ---
def check_and_perform_reset():
    """
    Checks for a `.reset_pending` flag file on startup. If found, it performs
    a factory reset and then removes the flag. This runs before the server starts.
    """
    reset_flag_file = os.path.join(application_path, ".reset_pending")
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


# --- Pydantic Models ---
from pydantic import BaseModel, ValidationError

class RenameTagRequest(BaseModel):
    new_name: str

class ChangeCategoryRequest(BaseModel):
    new_category: str

class UpdateTagsRequest(BaseModel):
    tags: List[str] = []

# --- Application Initialization ---
check_and_perform_reset() # Factory reset call

app = FastAPI(
    title="local-booru",
    description="A self-hosted image gallery with advanced tagging.",
    version="2.1.0",
)

# --- Static File and Template Configuration ---
os.makedirs(os.path.join(MEDIA_DIR, "images"), exist_ok=True)
os.makedirs(THUMBNAIL_DIR, exist_ok=True)

app.mount("/static", StaticFiles(directory=resource_path("static")), name="static")
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")
app.mount("/media/thumbnails", StaticFiles(directory=THUMBNAIL_DIR), name="thumbnails")
templates = Jinja2Templates(directory=resource_path("templates"))


# --- CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Configuration (SQLite) ---
# DATABASE_URL is now defined in the Constants section
Base = declarative_base()
engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

tags_table = Table(
    'image_tags', Base.metadata,
    Column('image_id', Integer, ForeignKey('images.id'), primary_key=True),
    Column('tag_id', Integer, ForeignKey('tags.id'), primary_key=True)
)

# --- SQLAlchemy ORM Models ---

class Image(Base):
    __tablename__ = 'images'
    id = Column(Integer, primary_key=True)
    filename = Column(String, unique=True, nullable=False)
    sha256_hash = Column(String(64), unique=True, nullable=False, index=True)
    tags = relationship("Tag", secondary=tags_table, back_populates="images")

class Tag(Base):
    __tablename__ = 'tags'
    id = Column(Integer, primary_key=True)
    # The `name` column is no longer unique on its own.
    name = Column(String, nullable=False)
    # Tags are now categorized, with 'general' as the default.
    category = Column(String, nullable=False, default='general', server_default='general')
    # This timestamp tracks when a tag was last assigned to an image.
    last_used_at = Column(DateTime, default=datetime.utcnow, server_default=func.now(), nullable=False)
    images = relationship("Image", secondary=tags_table, back_populates="tags")
    # A tag is now defined by the unique combination of its name and category.
    __table_args__ = (UniqueConstraint('name', 'category', name='_name_category_uc'),)

Base.metadata.create_all(engine)

# --- Database Session Dependency ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Helper Functions ---

def calculate_sha256(file: IO[bytes]) -> str:
    """Calculates the SHA256 hash of a file-like object by reading it in chunks."""
    sha256_hash = hashlib.sha256()
    # Read the file in 4MB chunks
    for byte_block in iter(lambda: file.read(4096 * 1024), b""):
        sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()

def get_or_create_tags(db: Session, raw_tag_inputs: set) -> List[Tag]:
    """
    Parses raw tag strings (e.g., 'artist:name', 'tag_name'), groups them by
    category, efficiently retrieves or creates them, and updates their
    'last_used_at' timestamp.
    """
    tags_to_process = []
    if not raw_tag_inputs:
        return tags_to_process

    # Group tag names by their category for efficient batch processing.
    parsed_tags_by_category: Dict[str, set] = {}
    for raw_tag in raw_tag_inputs:
        if ':' in raw_tag:
            category, name = raw_tag.split(':', 1)
            if category not in VALID_CATEGORIES:
                category = 'general' # Fallback for invalid categories
        else:
            category, name = 'general', raw_tag
        
        if category not in parsed_tags_by_category:
            parsed_tags_by_category[category] = set()
        parsed_tags_by_category[category].add(name)

    # For each category, find existing tags and create new ones in a single batch.
    for category, names in parsed_tags_by_category.items():
        existing_tags = db.query(Tag).filter(Tag.category == category, Tag.name.in_(names)).all()
        existing_names = {t.name for t in existing_tags}
        tags_to_process.extend(existing_tags)
        
        for name in names:
            if name not in existing_names:
                new_tag = Tag(name=name, category=category)
                db.add(new_tag)
                tags_to_process.append(new_tag)
    
    # Flush the session to ensure new tags are assigned an ID.
    db.flush()

    # "Touch" all processed tags to update their usage timestamp.
    now = datetime.utcnow()
    for tag in tags_to_process:
        tag.last_used_at = now
            
    return tags_to_process

def create_thumbnail(original_path: str, thumbnail_path: str, size: tuple = (600, 600)):
    """Creates a thumbnail for an image, preserving aspect ratio."""
    try:
        with PILImage.open(original_path) as img:
            # Convert to RGB to avoid issues with paletted images (like GIFs) or PNGs with alpha
            img = img.convert("RGB") 
            img.thumbnail(size)
            img.save(thumbnail_path, "JPEG", quality=85)
    except Exception as e:
        print(f"ERROR: Could not create thumbnail for {original_path}. Reason: {e}")


# --- Frontend Page Routes ---
@app.get("/", response_class=HTMLResponse)
def index(request: Request, db: Session = Depends(get_db)):
    image_count = db.query(Image).count()
    latest_version = app.version
    return templates.TemplateResponse("index.html", {"request": request, "image_count": image_count, "latest_version": latest_version, "active_page": "home"})

@app.get("/upload", response_class=HTMLResponse)
def upload_page(request: Request):
    return templates.TemplateResponse("upload.html", {"request": request, "active_page": "upload"})

@app.get("/gallery", response_class=HTMLResponse)
def gallery(request: Request, q: Optional[str] = Query(None)):
    return templates.TemplateResponse("gallery.html", {"request": request, "query": q or "", "active_page": "gallery"})

@app.get("/batch_actions", response_class=HTMLResponse)
def batch_actions(request: Request, q: Optional[str] = Query(None)):
    return templates.TemplateResponse("batch_actions.html", {"request": request, "query": q or "", "active_page": "batch_actions"})

@app.get("/tag_manager", response_class=HTMLResponse)
def tag_manager_page(request: Request):
    return templates.TemplateResponse("tag_manager.html", {"request": request, "active_page": "tag_manager"})

@app.get("/saved_searches", response_class=HTMLResponse)
def saved_searches_page(request: Request):
    return templates.TemplateResponse("saved_searches.html", {"request": request, "active_page": "saved_searches"})

@app.get("/help", response_class=HTMLResponse)
def help_page(request: Request):
    return templates.TemplateResponse("help.html", {"request": request, "active_page": "help"})

@app.get("/settings", response_class=HTMLResponse)
def settings_page(request: Request):
    return templates.TemplateResponse("settings.html", {"request": request, "active_page": "settings"})

# --- API Endpoints ---

@app.post("/upload")
def upload_images(
    files: List[UploadFile] = File(...),
    tags: str = Form(""),
    db: Session = Depends(get_db),
):
    tag_names = {t.strip().lower() for t in tags.split(',') if t.strip()}
    tags_to_add = get_or_create_tags(db, tag_names)
    uploaded_count = 0
    
    # Fetch all existing hashes at once to minimize database queries inside the loop.
    existing_hashes = {res[0] for res in db.query(Image.sha256_hash).all()}

    for file in files:
        if not file.content_type.startswith("image/"):
            continue

        # Reset the file's stream position to the beginning.
        # This is crucial because calculate_sha256 will read the stream to the end.
        file.file.seek(0)
        
        file_hash = calculate_sha256(file.file)
        if file_hash in existing_hashes:
            continue
        
        try:
            # Use the content type to suggest a more reliable extension.
            subtype = file.content_type.split('/')[-1]
            extension = os.path.splitext(file.filename)[1].lstrip('.') or subtype or "jpg"
        except (IndexError, AttributeError):
            extension = "jpg"
            
        unique_filename = f"{uuid.uuid4().hex}.{extension}"
        path = os.path.join(MEDIA_DIR, "images", unique_filename)
        
        try:
            # Reset the file stream again before the final write operation.
            # This ensures that shutil.copyfileobj can read the file from the beginning.
            file.file.seek(0)
            with open(path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            # After saving the original, create its thumbnail
            thumbnail_filename = f"{os.path.splitext(unique_filename)[0]}.jpg"
            thumbnail_path = os.path.join(THUMBNAIL_DIR, thumbnail_filename)
            create_thumbnail(path, thumbnail_path)

            image = Image(filename=unique_filename, sha256_hash=file_hash, tags=tags_to_add)
            db.add(image)
            
            existing_hashes.add(file_hash)
            uploaded_count += 1
        
        finally:
            file.file.close()

    db.commit()
    return JSONResponse(
        {"message": f"{uploaded_count} image(s) uploaded successfully."},
        status_code=200
    )

# This new endpoint replaces the old form-based /retag/{image_id} route.
# It accepts a JSON body, making it suitable for modern frontend interactions.
@app.put("/api/image/{image_id}/tags")
def api_update_image_tags(image_id: int, request: UpdateTagsRequest, db: Session = Depends(get_db)):
    """
    Replaces all tags on a single image. Designed for the new lightbox editor.
    """
    image = db.query(Image).options(orm.joinedload(Image.tags)).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # The frontend sends a list of raw tag strings (e.g., "artist:someone", "general_tag")
    tag_names = {t.strip().lower() for t in request.tags if t.strip()}
    image.tags = get_or_create_tags(db, tag_names)
    db.commit()

    # Return the updated tag list in the standard, sorted format for immediate UI update.
    updated_tags = sorted(
        [{"name": tag.name, "category": tag.category} for tag in image.tags],
        key=lambda t: (t['category'], t['name'])
    )
    return JSONResponse({"message": "Tags updated successfully.", "tags": updated_tags})

@app.get("/api/images")
def api_get_images(
    q: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(Image).options(orm.selectinload(Image.tags))
    if q:
        q_clean = q.strip().lower()
        if q_clean == 'untagged':
            query = query.filter(~Image.tags.any())
        else:
            q_processed = q_clean.replace(' and ', ',')
            and_groups = [group.strip() for group in q_processed.split(',') if group.strip()]
            all_conditions = []
            for group in and_groups:
                is_negative = group.startswith('-')
                group_content = group[1:] if is_negative else group
                
                # Handle OR groups like `(tag1|tag2)`
                if group_content.startswith('(') and group_content.endswith(')'):
                    or_tags = [t.strip() for t in group_content[1:-1].replace(' or ', '|').split('|') if t.strip()]
                    if or_tags:
                        or_conditions = []
                        for t in or_tags:
                            # Parse category from each tag inside the OR group
                            cat_filt, name_filt = ('general', t)
                            if ':' in t:
                                cat_t, name_t = t.split(':', 1)
                                if cat_t in VALID_CATEGORIES:
                                    cat_filt, name_filt = cat_t, name_t
                            
                            condition = Image.tags.any(and_(Tag.name.ilike(name_filt.replace('*', '%')), Tag.category == cat_filt)) if '*' in name_filt else Image.tags.any(and_(Tag.name == name_filt, Tag.category == cat_filt))
                            or_conditions.append(condition)
                        
                        final_or_condition = or_(*or_conditions)
                        all_conditions.append(~final_or_condition if is_negative else final_or_condition)
                else:
                    # Handle standard AND tags
                    cat_filt, name_filt = ('general', group_content)
                    if ':' in group_content:
                        cat_t, name_t = group_content.split(':', 1)
                        if cat_t in VALID_CATEGORIES:
                            cat_filt, name_filt = cat_t, name_t

                    condition = Image.tags.any(and_(Tag.name.ilike(name_filt.replace('*', '%')), Tag.category == cat_filt)) if '*' in name_filt else Image.tags.any(and_(Tag.name == name_filt, Tag.category == cat_filt))
                    all_conditions.append(~condition if is_negative else condition)

            if all_conditions:
                query = query.filter(and_(*all_conditions))

    total = query.count()
    images = query.order_by(desc(Image.id)).offset((page - 1) * limit).limit(limit).all()
    # The API now returns a list of tag objects, each with a name and category.
    result = [{
        "id": image.id, 
        "filename": image.filename, 
        "tags": sorted([{"name": tag.name, "category": tag.category} for tag in image.tags], key=lambda t: (t['category'], t['name']))
    } for image in images]
    return JSONResponse({"images": result, "page": page, "limit": limit, "total": total, "has_more": (page * limit) < total})

@app.get("/api/tags/recent")
def api_get_recent_tags(limit: int = Query(25, ge=1, le=100), db: Session = Depends(get_db)):
    """
    Returns the most recently USED tags, which is useful for the Tag Helper UI.
    """
    recent_tags = db.query(Tag).order_by(desc(Tag.last_used_at)).limit(limit).all()
    results = []
    for tag in recent_tags:
        if tag.category == 'general':
            results.append(tag.name)
        else:
            results.append(f"{tag.category}:{tag.name}")
    return JSONResponse(results)

@app.get("/api/tags/autocomplete")
def api_autocomplete_tags(q: Optional[str] = Query(None, min_length=1), limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    if not q: return []
    query_str = q.strip().lower()
    
    tags_query = db.query(Tag.name, Tag.category)
    # If a category prefix is typed, filter by it. Otherwise, search all categories.
    if ':' in query_str:
        category, name_part = query_str.split(':', 1)
        if category in VALID_CATEGORIES:
            tags_query = tags_query.filter(Tag.category == category, Tag.name.ilike(f"{name_part}%"))
        else:
             tags_query = tags_query.filter(Tag.category == 'general', Tag.name.ilike(f"{query_str}%"))
    else:
        tags_query = tags_query.filter(Tag.name.ilike(f"{query_str}%"))

    tags = tags_query.order_by(Tag.name).limit(limit).all()
    
    # Format results to include the prefix for non-general tags.
    results = []
    for name, category in tags:
        if category == 'general':
            results.append(name)
        else:
            results.append(f"{category}:{name}")
    return results

@app.post("/api/images/batch_delete")
def api_batch_delete_images(image_ids: List[int] = Form(...), db: Session = Depends(get_db)):
    if not image_ids: raise HTTPException(status_code=400, detail="No image IDs provided.")
    images_to_delete = db.query(Image).filter(Image.id.in_(image_ids)).all()
    deleted_count = 0
    for image in images_to_delete:
        # Delete original image
        image_path = os.path.join(MEDIA_DIR, "images", image.filename)
        if os.path.exists(image_path): os.remove(image_path)
        
        # Delete thumbnail
        thumbnail_filename = f"{os.path.splitext(image.filename)[0]}.jpg"
        thumbnail_path = os.path.join(THUMBNAIL_DIR, thumbnail_filename)
        if os.path.exists(thumbnail_path): os.remove(thumbnail_path)
            
        db.delete(image)
        deleted_count += 1
    db.commit()
    return {"message": f"Successfully deleted {deleted_count} image(s)."}


@app.delete("/api/image/{image_id}")
def api_delete_image(image_id: int, db: Session = Depends(get_db)):
    """Deletes a single image and its thumbnail by its ID."""
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found.")

    # Delete original image
    image_path = os.path.join(MEDIA_DIR, "images", image.filename)
    if os.path.exists(image_path):
        os.remove(image_path)

    # Delete thumbnail
    thumbnail_filename = f"{os.path.splitext(image.filename)[0]}.jpg"
    thumbnail_path = os.path.join(THUMBNAIL_DIR, thumbnail_filename)
    if os.path.exists(thumbnail_path):
        os.remove(thumbnail_path)

    db.delete(image)
    db.commit()
    return {"message": f"Successfully deleted image {image_id}."}


@app.post("/batch_retag")
def batch_retag(
    image_ids: List[int] = Form(...),
    tags: str = Form(""),
    action: str = Form(...),
    db: Session = Depends(get_db),
):
    """
    Performs a tag operation (add, remove, or replace) on a batch of images.
    Saves the 'before' state to a file for persistent undo.
    """
    if action not in {"add", "remove", "replace"}:
        raise HTTPException(status_code=400, detail="Invalid action specified.")
    if not image_ids:
        raise HTTPException(status_code=400, detail="No image IDs provided.")

    images_to_update = db.query(Image).filter(Image.id.in_(image_ids)).options(orm.joinedload(Image.tags)).all()
    if not images_to_update:
        raise HTTPException(status_code=404, detail="Images not found for batch update.")

    # The 'before' state for undo must store full 'category:name' format for accurate restoration.
    images_before_state = {}
    for img in images_to_update:
        img_tags = []
        for tag in sorted(img.tags, key=lambda t: (t.category, t.name)):
            if tag.category == 'general':
                img_tags.append(tag.name)
            else:
                img_tags.append(f"{tag.category}:{tag.name}")
        images_before_state[img.id] = img_tags

    try:
        with open(UNDO_STATE_FILE, 'w') as f:
            json.dump(images_before_state, f, indent=4)
    except IOError as e:
        raise HTTPException(status_code=500, detail=f"Could not save undo state: {e}")

    raw_tag_inputs = {t.strip().lower() for t in tags.split(',') if t.strip()}
    
    if action in {"add", "replace"}:
        tags_for_action = get_or_create_tags(db, raw_tag_inputs)

    for img in images_to_update:
        if action == "replace":
            img.tags = tags_for_action
        elif action == "add":
            current_tags_set = {(tag.name, tag.category) for tag in img.tags}
            tags_to_append = [tag for tag in tags_for_action if (tag.name, tag.category) not in current_tags_set]
            img.tags.extend(tags_to_append)
        elif action == "remove":
            # Removal must also be category-aware.
            tags_to_remove_spec = set()
            for raw_tag in raw_tag_inputs:
                category, name = ('general', raw_tag)
                if ':' in raw_tag:
                    cat, n = raw_tag.split(':', 1)
                    if cat in VALID_CATEGORIES:
                        category, name = cat, n
                tags_to_remove_spec.add((name, category))
            
            img.tags = [tag for tag in img.tags if (tag.name, tag.category) not in tags_to_remove_spec]
    
    db.commit()
    return JSONResponse({"message": "Batch tags updated successfully."})

@app.post("/batch_undo")
def batch_undo(db: Session = Depends(get_db)):
    """
    Reverts the last batch tag operation by reading from the undo state file.
    """
    if not os.path.exists(UNDO_STATE_FILE):
        raise HTTPException(status_code=400, detail="No batch operation found to undo.")

    try:
        with open(UNDO_STATE_FILE, 'r') as f:
            images_before_state = json.load(f)
    except (IOError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=500, detail=f"Could not read or parse undo state: {e}")

    image_ids_to_revert = [int(k) for k in images_before_state.keys()]
    
    # Re-create all tags that were present before the operation.
    all_raw_tags_needed = {raw_tag for tag_list in images_before_state.values() for raw_tag in tag_list}
    tags_for_revert_list = get_or_create_tags(db, all_raw_tags_needed)
    tag_map = {(tag.name, tag.category): tag for tag in tags_for_revert_list}
    images_to_revert = db.query(Image).filter(Image.id.in_(image_ids_to_revert)).all()

    for img in images_to_revert:
        previous_raw_tags = images_before_state.get(str(img.id), [])
        reverted_tags_for_image = []
        for raw_tag in previous_raw_tags:
            category, name = ('general', raw_tag)
            if ':' in raw_tag:
                cat, n = raw_tag.split(':', 1)
                if cat in VALID_CATEGORIES:
                    category, name = cat, n

            if (name, category) in tag_map:
                reverted_tags_for_image.append(tag_map[(name, category)])
        img.tags = reverted_tags_for_image
    
    db.commit()

    try:
        os.remove(UNDO_STATE_FILE)
    except OSError:
        print(f"Warning: Could not delete undo state file '{UNDO_STATE_FILE}'.")
    
    return JSONResponse({"message": "The last batch operation was successfully undone."})


@app.get("/api/tags/summary")
def api_get_tags_summary(db: Session = Depends(get_db)):
    tags_with_counts = (db.query(Tag, func.count(tags_table.c.image_id))
                        .outerjoin(tags_table)
                        .group_by(Tag.id)
                        .order_by(Tag.category, Tag.name)
                        .all())
    untagged_count = db.query(Image).filter(~Image.tags.any()).count()
    tags_data = [{"id": tag.id, "name": tag.name, "category": tag.category, "count": count} for tag, count in tags_with_counts]
    return JSONResponse({"tags": tags_data, "untagged_count": untagged_count})

@app.post("/api/tags/force_delete/{tag_id}")
def api_force_delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag: raise HTTPException(status_code=404, detail="Tag not found.")
    tag.images.clear()
    db.delete(tag)
    db.commit()
    return {"message": f"Tag '{tag.category}:{tag.name}' and its associations were deleted."}

@app.post("/api/tags/rename/{tag_id}")
def api_rename_tag(tag_id: int, request: RenameTagRequest, db: Session = Depends(get_db)):
    tag_to_rename = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag_to_rename: raise HTTPException(status_code=404, detail="Tag to rename not found.")
    
    new_name_clean = request.new_name.strip().lower()
    if not new_name_clean: raise HTTPException(status_code=400, detail="New tag name cannot be empty.")
    
    # Check for uniqueness within the same category.
    if db.query(Tag).filter(Tag.name == new_name_clean, Tag.category == tag_to_rename.category).first():
        raise HTTPException(status_code=400, detail=f"A tag named '{new_name_clean}' already. exists in the '{tag_to_rename.category}' category.")
    
    tag_to_rename.name = new_name_clean
    db.commit()
    return {"message": f"Tag renamed to '{new_name_clean}'."}

@app.post("/api/tags/merge")
def api_merge_tags(tag_id_to_keep: int = Form(...), tag_id_to_delete: int = Form(...), db: Session = Depends(get_db)):
    if tag_id_to_keep == tag_id_to_delete: raise HTTPException(status_code=400, detail="Cannot merge a tag with itself.")
    
    tag_to_keep = db.query(Tag).filter(Tag.id == tag_id_to_keep).first()
    tag_to_delete = db.query(Tag).options(orm.selectinload(Tag.images)).filter(Tag.id == tag_id_to_delete).first()
    
    if not tag_to_keep or not tag_to_delete: raise HTTPException(status_code=404, detail="One or both tags were not found.")
    
    # Re-assign all images from the deleted tag to the kept tag.
    # This allows for merging across categories.
    for image in tag_to_delete.images:
        if tag_to_keep not in image.tags:
            image.tags.append(tag_to_keep)

    # After merging, the kept tag has been "used", so update its timestamp.
    tag_to_keep.last_used_at = datetime.utcnow()
    
    tag_to_delete.images.clear()
    db.delete(tag_to_delete)
    db.commit()
    return {"message": f"Tag '{tag_to_delete.name}' merged into '{tag_to_keep.name}'."}

@app.post("/api/tags/change_category/{tag_id}")
def api_change_tag_category(tag_id: int, request: ChangeCategoryRequest, db: Session = Depends(get_db)):
    tag_to_change = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag_to_change: raise HTTPException(status_code=404, detail="Tag not found.")

    new_category = request.new_category.strip().lower()
    if new_category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category provided. Must be one of: {', '.join(VALID_CATEGORIES)}")

    # Check if a tag with the same name already exists in the new category.
    if db.query(Tag).filter(Tag.name == tag_to_change.name, Tag.category == new_category).first():
        raise HTTPException(status_code=400, detail=f"A tag named '{tag_to_change.name}' already exists in the '{new_category}' category. Please merge them instead.")
    
    original_category = tag_to_change.category
    tag_to_change.category = new_category
    db.commit()
    return {"message": f"Category for tag '{tag_to_change.name}' changed from '{original_category}' to '{new_category}'."}

@app.get("/api/export_collection")
async def api_export_collection(db: Session = Depends(get_db)):
    """
    Creates and streams a zip archive of the entire collection using a temporary
    file on disk. This is memory-efficient and allows the browser to show
    download progress.
    """
    all_images = db.query(Image).options(orm.selectinload(Image.tags)).order_by(Image.id).all()
    
    images_metadata = []
    for image in all_images:
        tags_list = []
        for tag in sorted(image.tags, key=lambda t: (t.category, t.name)):
            if tag.category == 'general':
                tags_list.append(tag.name)
            else:
                tags_list.append(f"{tag.category}:{tag.name}")
        
        images_metadata.append({
            "filename": image.filename,
            "sha256_hash": image.sha256_hash,
            "tags": tags_list
        })

    final_metadata = {
        "app_version": app.version,
        "export_date": datetime.now(timezone.utc).isoformat(),
        "images": images_metadata
    }

    # Create a temporary file on disk to build the zip archive.
    # delete=False is crucial so we can control its lifecycle.
    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    
    try:
        # Build the zip file on disk, not in memory.
        with zipfile.ZipFile(temp_file, 'w', zipfile.ZIP_STORED) as zipf:
            zipf.writestr("metadata.json", json.dumps(final_metadata, indent=4))
            
            images_dir = os.path.join(MEDIA_DIR, "images")
            for image_meta in images_metadata:
                source_path = os.path.join(images_dir, image_meta["filename"])
                archive_path = os.path.join("images", image_meta["filename"])
                if os.path.exists(source_path):
                    zipf.write(source_path, archive_path)
    
        # The temporary file is now complete. Get its size for the Content-Length header.
        file_size = temp_file.tell()
        temp_file.seek(0) # Rewind to the beginning for streaming.

        headers = {
            'Content-Length': str(file_size),
            'Content-Disposition': f"attachment; filename=booru_export_{datetime.now().strftime('%Y%m%d')}.zip"
        }

        # This generator function reads the file and ensures it gets deleted.
        def file_iterator(file_path):
            with open(file_path, 'rb') as f:
                while chunk := f.read(8192): # Read in 8KB chunks
                    yield chunk
            # The key cleanup step: delete the temp file after streaming is done.
            os.unlink(file_path)
        
        return StreamingResponse(
            file_iterator(temp_file.name),
            media_type="application/zip",
            headers=headers
        )

    except Exception as e:
        # If anything fails, make sure we clean up the temp file.
        os.unlink(temp_file.name)
        raise HTTPException(status_code=500, detail=f"Failed to create zip archive: {e}")
    finally:
        # This ensures the file handle is closed.
        temp_file.close()

@app.post("/api/factory_reset")
def api_schedule_factory_reset():
    """
    Schedules a factory reset by creating a flag file. The reset will occur
    the next time the application is started.
    """
    try:
        with open(os.path.join(application_path, ".reset_pending"), "w") as f:
            f.write("reset")
    except IOError as e:
        raise HTTPException(status_code=500, detail=f"Could not schedule reset. Reason: {e}")

    return JSONResponse({"message": "Reset has been scheduled. Please stop and restart the application server to complete the process."})

@app.post("/api/import_collection")
async def api_import_collection(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Imports a collection from a previously exported .zip file.
    ...
    4. For each new image, it copies the image file AND generates a new thumbnail.
    5. Add the new images and their tags to the database.
    """
    if not file.filename.endswith('.zip'):
        raise HTTPException(status_code=400, detail="Invalid file type. Please upload a .zip file.")

    # Create a secure temporary directory to extract the archive.
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            # Save the uploaded zip file temporarily
            temp_zip_path = os.path.join(temp_dir, file.filename)
            with open(temp_zip_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)
            
            # Extract the zip file
            with zipfile.ZipFile(temp_zip_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)
        except zipfile.BadZipFile:
            raise HTTPException(status_code=400, detail="The uploaded file is not a valid zip archive.")
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Failed to process zip file: {e}")

        # Verify the contents of the zip file
        metadata_path = os.path.join(temp_dir, 'metadata.json')
        images_dir_path = os.path.join(temp_dir, 'images')

        if not os.path.exists(metadata_path) or not os.path.exists(images_dir_path):
            raise HTTPException(status_code=400, detail="The zip archive is missing 'metadata.json' or the 'images/' directory.")

        try:
            with open(metadata_path, 'r') as f:
                metadata = json.load(f)
        except (json.JSONDecodeError, ValidationError):
            raise HTTPException(status_code=400, detail="Could not parse 'metadata.json'. The file may be corrupt.")

        images_to_import = metadata.get('images', [])
        if not images_to_import:
            return JSONResponse({"message": "Metadata file contains no images to import."})

        # --- Main Import Logic ---
        # 1. Get all existing hashes for efficient duplicate checking.
        existing_hashes = {res[0] for res in db.query(Image.sha256_hash).all()}
        imported_count = 0
        skipped_count = 0

        for image_data in images_to_import:
            # 2. Skip if image already exists in the database.
            if image_data.get('sha256_hash') in existing_hashes:
                skipped_count += 1
                continue
            
            # 3. Copy the physical image file.
            source_image_path = os.path.join(images_dir_path, image_data['filename'])
            dest_image_path = os.path.join(MEDIA_DIR, "images", image_data['filename'])
            
            if not os.path.exists(source_image_path):
                continue # Skip if the image file is missing from the archive
            
            shutil.copy(source_image_path, dest_image_path)
            
            # 4. Generate thumbnail for the newly imported image.
            thumbnail_filename = f"{os.path.splitext(image_data['filename'])[0]}.jpg"
            thumbnail_path = os.path.join(THUMBNAIL_DIR, thumbnail_filename)
            create_thumbnail(dest_image_path, thumbnail_path)
            
            # 5. Get or create tags for the new image.
            raw_tags = set(image_data.get('tags', []))
            tags_for_image = get_or_create_tags(db, raw_tags)
            
            # 6. Create the new Image database record.
            new_image = Image(
                filename=image_data['filename'],
                sha256_hash=image_data['sha256_hash'],
                tags=tags_for_image
            )
            db.add(new_image)
            
            existing_hashes.add(new_image.sha256_hash)
            imported_count += 1

        db.commit()

    return JSONResponse({
        "message": f"Import complete. Added {imported_count} new images and skipped {skipped_count} duplicates."
    })


if __name__ == "__main__":
    import uvicorn
    
    # This check is crucial for distinguishing between development and packaged mode
    is_packaged = getattr(sys, 'frozen', False)

    if is_packaged:
        # Running in a PyInstaller bundle.
        # We must pass the app object directly and disable reloading.
        uvicorn.run(
            app,  # Pass the FastAPI app object directly
            host="0.0.0.0",
            port=8000
            # reload is False by default
        )
    else:
        # Running as a standard Python script.
        # Use the string format to allow the reloader to work.
        # Change host to 127.0.0.1 if you don't want other devices in your LAN being able to access this app
        uvicorn.run(
            "main:app",
            host="0.0.0.0",
            port=8000,
            reload=True
        )