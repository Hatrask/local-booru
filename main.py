import shutil, os, uuid, json, hashlib, sqlite3
from fastapi import FastAPI, UploadFile, File, Form, Request, Depends, Query, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import Column, Integer, String, Table, ForeignKey, create_engine, desc, orm, func, or_, and_, UniqueConstraint
from sqlalchemy.orm import relationship, sessionmaker, declarative_base, Session
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict

# --- Pydantic Models ---
from pydantic import BaseModel

class RenameTagRequest(BaseModel):
    new_name: str

# New: Pydantic model for the change category request
class ChangeCategoryRequest(BaseModel):
    new_category: str

# --- Application Initialization ---
app = FastAPI(
    title="local-booru",
    description="A self-hosted image gallery with advanced tagging.",
    version="1.5.0",
)

# --- Constants ---
UNDO_STATE_FILE = "undo_state.json"
# New: Define valid categories for tags
VALID_CATEGORIES = {"general", "artist", "character", "copyright", "metadata"}


# --- Static File and Template Configuration ---
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/media", StaticFiles(directory="media"), name="media")
templates = Jinja2Templates(directory="templates")
os.makedirs("media/images", exist_ok=True)

# --- CORS Middleware ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Database Configuration (SQLite) ---
DATABASE_URL = "sqlite:///database.db"
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
    name = Column(String, unique=False, nullable=False) # New: Changed unique to False, as uniqueness is now handled by the constraint
    # New: Add category to tags. Default is 'general'.
    category = Column(String, nullable=False, default='general', server_default='general')
    images = relationship("Image", secondary=tags_table, back_populates="tags")
    # New: A tag must be unique based on its name AND category.
    __table_args__ = (UniqueConstraint('name', 'category', name='_name_category_uc'),)


# ==============================================================================
# ONE-TIME DATABASE MIGRATION - TO BE REMOVED IN FUTURE VERSIONS
# ==============================================================================
# The following function `run_migration()` is designed to upgrade an existing v1
# database to the v2 schema (which includes tag categories). It is idempotent
# and safe to run on every startup.
#
# FOR FUTURE MAINTENANCE: Once the application is stable and this migration is
# no longer needed for development or initial user upgrades, this function and
# its call below (`run_migration()`) should be removed to reduce code complexity
# and startup time. The application will then rely solely on SQLAlchemy's
# `Base.metadata.create_all(engine)` for creating new databases from scratch.
#
def run_migration():
    """
    Applies necessary database schema changes on application startup.
    It checks for the 'category' column and the unique constraint on the 'tags' table,
    adding them if they are missing and backfilling existing tags to 'general'.
    """
    try:
        conn = sqlite3.connect(DATABASE_URL.replace("sqlite:///", ""))
        cursor = conn.cursor()
        
        cursor.execute("PRAGMA table_info(tags)")
        columns = {column[1]: column for column in cursor.fetchall()}
        
        if 'category' not in columns:
            print("INFO:     Database migration required: 'category' column missing.")
            print("INFO:     Adding 'category' column and backfilling existing tags to 'general'.")
            cursor.execute("ALTER TABLE tags ADD COLUMN category VARCHAR NOT NULL DEFAULT 'general'")
            conn.commit()
            print("INFO:     'category' column added successfully.")

        try:
            cursor.execute("CREATE UNIQUE INDEX IF NOT EXISTS _name_category_uc ON tags (name, category)")
            conn.commit()
        except sqlite3.OperationalError as e:
            if "already exists" in str(e):
                pass
            else:
                raise

        if 'name' in columns and columns['name'][5] == 1:
            cursor.execute("PRAGMA index_list(tags)")
            indexes = cursor.fetchall()
            for index in indexes:
                if index[2] == 1 and "autoindex" in index[1] and "name" in index[1]:
                    print("INFO:     Found legacy unique index on 'name' column. This is now handled by a composite index.")
                    break

        conn.close()
    except Exception as e:
        print(f"ERROR:    An error occurred during database migration: {e}")
        pass

# Run the one-time migration before SQLAlchemy handles table creation.
run_migration()
# ==============================================================================
# END OF MIGRATION CODE
# ==============================================================================

Base.metadata.create_all(engine)

# --- Database Session Dependency ---
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# --- Helper Functions ---

def calculate_sha256(file_like_object) -> str:
    """Calculates the SHA256 hash of a file-like object in a memory-efficient way."""
    sha256_hash = hashlib.sha256()
    # Reset file pointer to the beginning
    file_like_object.seek(0)
    # Read and update hash in chunks of 4K
    for byte_block in iter(lambda: file_like_object.read(4096), b""):
        sha256_hash.update(byte_block)
    # Reset file pointer again for subsequent operations (like saving)
    file_like_object.seek(0)
    return sha256_hash.hexdigest()

# New: This function is rewritten to handle categories.
def get_or_create_tags(db: Session, raw_tag_inputs: set) -> List[Tag]:
    """
    Parses raw tag inputs (e.g., 'artist:hoge', 'fuga'), separates them by
    category, and retrieves or creates them in the database.
    Tags without a prefix are assigned the 'general' category.
    """
    tags_to_process = []
    if not raw_tag_inputs:
        return tags_to_process

    parsed_tags_by_category = {}
    for raw_tag in raw_tag_inputs:
        # Split tag into category and name if a prefix exists
        if ':' in raw_tag:
            category, name = raw_tag.split(':', 1)
            # Ensure the provided category is valid, otherwise default to general
            if category not in VALID_CATEGORIES:
                category = 'general'
        else:
            category, name = 'general', raw_tag
        
        # Group names by category for efficient querying
        if category not in parsed_tags_by_category:
            parsed_tags_by_category[category] = set()
        parsed_tags_by_category[category].add(name)

    # Query for existing tags in batches by category
    for category, names in parsed_tags_by_category.items():
        existing_tags = db.query(Tag).filter(Tag.category == category, Tag.name.in_(names)).all()
        existing_names = {t.name for t in existing_tags}
        tags_to_process.extend(existing_tags)
        
        # Create new tags for names that were not found
        for name in names:
            if name not in existing_names:
                new_tag = Tag(name=name, category=category)
                db.add(new_tag)
                tags_to_process.append(new_tag)
                
    return tags_to_process

# --- Frontend Page Routes ---
@app.get("/", response_class=HTMLResponse)
def index(request: Request, db: Session = Depends(get_db)):
    image_count = db.query(Image).count()
    latest_version = app.version
    return templates.TemplateResponse("index.html", {"request": request, "image_count": image_count, "latest_version": latest_version})

@app.get("/upload", response_class=HTMLResponse)
def upload_page(request: Request):
    return templates.TemplateResponse("upload.html", {"request": request})

@app.get("/gallery", response_class=HTMLResponse)
def gallery(request: Request, q: Optional[str] = Query(None)):
    return templates.TemplateResponse("gallery.html", {"request": request, "query": q or ""})

@app.get("/batch_actions", response_class=HTMLResponse)
def batch_actions(request: Request, q: Optional[str] = Query(None)):
    return templates.TemplateResponse("batch_actions.html", {"request": request, "query": q or ""})

@app.get("/tag_manager", response_class=HTMLResponse)
def tag_manager_page(request: Request):
    return templates.TemplateResponse("tag_manager.html", {"request": request})

@app.get("/help", response_class=HTMLResponse)
def help_page(request: Request):
    return templates.TemplateResponse("help.html", {"request": request})

@app.get("/saved_searches", response_class=HTMLResponse)
def saved_searches_page(request: Request):
    return templates.TemplateResponse("saved_searches.html", {"request": request})

@app.get("/image/{image_id}", response_class=HTMLResponse)
def image_detail_page(request: Request, image_id: int, db: Session = Depends(get_db)):
    image = db.query(Image).options(orm.joinedload(Image.tags)).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # New: Format tags for display, adding category prefix for non-general tags.
    tags_list = []
    sorted_tags = sorted(image.tags, key=lambda t: (t.category, t.name))
    for tag in sorted_tags:
        if tag.category == 'general':
            tags_list.append(tag.name)
        else:
            tags_list.append(f"{tag.category}:{tag.name}")
    tags_str = ", ".join(tags_list)
    
    return templates.TemplateResponse("image_detail.html", {
        "request": request, "image": image, "tags_str": tags_str
    })

# --- API Endpoints ---

@app.post("/upload")
def upload_images(
    files: List[UploadFile] = File(...),
    tags: str = Form(""),
    db: Session = Depends(get_db),
):
    tag_names = {t.strip().lower() for t in tags.split(',') if t.strip()}
    # New: Uses the category-aware tag creation function
    tags_to_add = get_or_create_tags(db, tag_names)
    uploaded_count = 0
    
    # Get all existing hashes from the DB to check against.
    # This is more efficient than one query per file if uploading many files.
    existing_hashes = {res[0] for res in db.query(Image.sha256_hash).all()}

    for file in files:
        # Calculate the hash of the uploaded file
        file_hash = calculate_sha256(file.file)

        # If hash already exists, silently skip this file
        if file_hash in existing_hashes:
            continue
        
        try:
            extension = os.path.splitext(file.filename)[1].lstrip('.')
            if not extension: extension = "jpg"
        except IndexError:
            extension = "jpg"
            
        unique_filename = f"{uuid.uuid4().hex}.{extension}"
        path = f"media/images/{unique_filename}"
        
        with open(path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Add the new image with its hash to the database
        image = Image(filename=unique_filename, sha256_hash=file_hash, tags=tags_to_add)
        db.add(image)
        
        # Add the new hash to our set to prevent duplicate uploads within the same batch
        existing_hashes.add(file_hash)
        uploaded_count += 1
        
    db.commit()
    return JSONResponse(
        {"message": f"{uploaded_count} image(s) uploaded successfully."},
        status_code=200
    )

@app.post("/retag/{image_id}")
def retag_image(image_id: int, tags: str = Form(""), db: Session = Depends(get_db)):
    image = db.query(Image).options(orm.joinedload(Image.tags)).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    tag_names = {t.strip().lower() for t in tags.split(',') if t.strip()}
    # New: Uses the category-aware tag creation function
    image.tags = get_or_create_tags(db, tag_names)
    db.commit()
    return RedirectResponse(f"/image/{image_id}", status_code=303)

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
                
                if group_content.startswith('(') and group_content.endswith(')'):
                    or_tags = [t.strip() for t in group_content[1:-1].replace(' or ', '|').split('|') if t.strip()]
                    if or_tags:
                        or_conditions = []
                        # New: OR logic now handles categories
                        for t in or_tags:
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
                    # New: AND logic now handles categories
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
    # New: The API response format for tags is changed to a list of objects.
    result = [{
        "id": image.id, 
        "filename": image.filename, 
        "tags": sorted([{"name": tag.name, "category": tag.category} for tag in image.tags], key=lambda t: (t['category'], t['name']))
    } for image in images]
    return JSONResponse({"images": result, "page": page, "limit": limit, "total": total, "has_more": (page * limit) < total})

@app.get("/api/tags/autocomplete")
def api_autocomplete_tags(q: Optional[str] = Query(None, min_length=1), limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    if not q: return []
    query_str = q.strip().lower()
    
    # New: Autocomplete now returns full `category:name` for non-general tags and filters by category prefix.
    tags_query = db.query(Tag.name, Tag.category)
    if ':' in query_str:
        category, name_part = query_str.split(':', 1)
        if category in VALID_CATEGORIES:
            tags_query = tags_query.filter(Tag.category == category, Tag.name.ilike(f"{name_part}%"))
        else: # If invalid prefix, search the whole thing as a general tag
             tags_query = tags_query.filter(Tag.category == 'general', Tag.name.ilike(f"{query_str}%"))
    else:
        tags_query = tags_query.filter(Tag.name.ilike(f"{query_str}%"))

    tags = tags_query.order_by(Tag.name).limit(limit).all()
    
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
        image_path = f"media/images/{image.filename}"
        if os.path.exists(image_path): os.remove(image_path)
        db.delete(image)
        deleted_count += 1
    db.commit()
    return {"message": f"Successfully deleted {deleted_count} image(s)."}


@app.delete("/api/image/{image_id}")
def api_delete_image(image_id: int, db: Session = Depends(get_db)):
    """Deletes a single image by its ID."""
    image = db.query(Image).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found.")

    image_path = f"media/images/{image.filename}"
    if os.path.exists(image_path):
        os.remove(image_path)

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

    # Create the state dictionary and save it to a file.
    # New: 'before' state now stores full 'category:name' format for accurate undo.
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
        # If we can't write the undo file, we shouldn't proceed with the action.
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
            # New: Removal must be category-aware.
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
    # Check for the undo state file instead of the global variable.
    if not os.path.exists(UNDO_STATE_FILE):
        raise HTTPException(status_code=400, detail="No batch operation found to undo.")

    try:
        with open(UNDO_STATE_FILE, 'r') as f:
            images_before_state = json.load(f)
    except (IOError, json.JSONDecodeError) as e:
        raise HTTPException(status_code=500, detail=f"Could not read or parse undo state: {e}")

    # The keys in the loaded dictionary are strings, so we convert them to int.
    image_ids_to_revert = [int(k) for k in images_before_state.keys()]
    
    # New: Logic is updated to correctly revert categorized tags.
    all_raw_tags_needed = {raw_tag for tag_list in images_before_state.values() for raw_tag in tag_list}
    tags_for_revert_list = get_or_create_tags(db, all_raw_tags_needed)
    
    tag_map = {(tag.name, tag.category): tag for tag in tags_for_revert_list}

    images_to_revert = db.query(Image).filter(Image.id.in_(image_ids_to_revert)).all()

    for img in images_to_revert:
        # JSON keys are strings, so we must use string version of ID to look up.
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

    # On successful revert, delete the undo state file.
    try:
        os.remove(UNDO_STATE_FILE)
    except OSError:
        # This is not a critical failure, so we just log it and proceed.
        print(f"Warning: Could not delete undo state file '{UNDO_STATE_FILE}'.")
    
    return JSONResponse({"message": "The last batch operation was successfully undone."})


@app.get("/api/tags/summary")
def api_get_tags_summary(db: Session = Depends(get_db)):
    # New: Summary now includes category.
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
    # New: Message is more informative.
    return {"message": f"Tag '{tag.category}:{tag.name}' and its associations were deleted."}

@app.post("/api/tags/rename/{tag_id}")
def api_rename_tag(tag_id: int, request: RenameTagRequest, db: Session = Depends(get_db)):
    tag_to_rename = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag_to_rename: raise HTTPException(status_code=404, detail="Tag to rename not found.")
    new_name_clean = request.new_name.strip().lower()
    if not new_name_clean: raise HTTPException(status_code=400, detail="New tag name cannot be empty.")
    # New: Check for uniqueness within the same category.
    if db.query(Tag).filter(Tag.name == new_name_clean, Tag.category == tag_to_rename.category).first():
        raise HTTPException(status_code=400, detail=f"A tag named '{new_name_clean}' already exists in the '{tag_to_rename.category}' category.")
    tag_to_rename.name = new_name_clean
    db.commit()
    return {"message": f"Tag renamed to '{new_name_clean}'."}

@app.post("/api/tags/merge")
def api_merge_tags(tag_id_to_keep: int = Form(...), tag_id_to_delete: int = Form(...), db: Session = Depends(get_db)):
    if tag_id_to_keep == tag_id_to_delete: raise HTTPException(status_code=400, detail="Cannot merge a tag with itself.")
    tag_to_keep = db.query(Tag).filter(Tag.id == tag_id_to_keep).first()
    tag_to_delete = db.query(Tag).options(orm.selectinload(Tag.images)).filter(Tag.id == tag_id_to_delete).first()
    if not tag_to_keep or not tag_to_delete: raise HTTPException(status_code=404, detail="One or both tags were not found.")
    
    # Corrected: The explicit check preventing cross-category merges has been removed
    # to restore the original, more flexible functionality.
    
    for image in tag_to_delete.images:
        if tag_to_keep not in image.tags: image.tags.append(tag_to_keep)
    
    tag_to_delete.images.clear()
    db.delete(tag_to_delete)
    db.commit()
    return {"message": f"Tag '{tag_to_delete.name}' merged into '{tag_to_keep.name}'."}

# New: Endpoint for changing a tag's category
@app.post("/api/tags/change_category/{tag_id}")
def api_change_tag_category(tag_id: int, request: ChangeCategoryRequest, db: Session = Depends(get_db)):
    tag_to_change = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag_to_change: raise HTTPException(status_code=404, detail="Tag not found.")

    new_category = request.new_category.strip().lower()
    if new_category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"Invalid category provided. Must be one of: {', '.join(VALID_CATEGORIES)}")

    # Check if a tag with the same name already exists in the new category, which would violate the unique constraint.
    if db.query(Tag).filter(Tag.name == tag_to_change.name, Tag.category == new_category).first():
        raise HTTPException(status_code=400, detail=f"A tag named '{tag_to_change.name}' already exists in the '{new_category}' category. Please merge them instead.")
    
    original_category = tag_to_change.category
    tag_to_change.category = new_category
    db.commit()
    return {"message": f"Category for tag '{tag_to_change.name}' changed from '{original_category}' to '{new_category}'."}


if __name__ == "__main__":
    import uvicorn
    # Change host to 127.0.0.1 if you don't want other devices in your LAN being able to access this app
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)