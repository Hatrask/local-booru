import shutil, os, uuid, json, hashlib
from fastapi import FastAPI, UploadFile, File, Form, Request, Depends, Query, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from sqlalchemy import Column, Integer, String, Table, ForeignKey, create_engine, desc, orm, func, or_, and_
from sqlalchemy.orm import relationship, sessionmaker, declarative_base, Session
from fastapi.middleware.cors import CORSMiddleware
from typing import List, Optional, Dict

# --- Pydantic Models ---
from pydantic import BaseModel

class RenameTagRequest(BaseModel):
    new_name: str

# --- Application Initialization ---
app = FastAPI(
    title="local-booru",
    description="A self-hosted image gallery with advanced tagging.",
    version="1.3.0",
)

# --- Constants ---
UNDO_STATE_FILE = "undo_state.json"

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
    name = Column(String, unique=True, nullable=False)
    images = relationship("Image", secondary=tags_table, back_populates="tags")

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

def get_or_create_tags(db: Session, tag_names: set) -> List[Tag]:
    tags_to_process = []
    if not tag_names:
        return tags_to_process
    existing_tags = {tag.name: tag for tag in db.query(Tag).filter(Tag.name.in_(tag_names)).all()}
    for name in tag_names:
        if name in existing_tags:
            tags_to_process.append(existing_tags[name])
        else:
            new_tag = Tag(name=name)
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
    tags_str = ", ".join(sorted([tag.name for tag in image.tags]))
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
                        or_conditions = [Image.tags.any(Tag.name.ilike(t.replace('*', '%'))) if '*' in t else Image.tags.any(Tag.name == t) for t in or_tags]
                        condition = or_(*or_conditions)
                        all_conditions.append(~condition if is_negative else condition)
                else:
                    condition = Image.tags.any(Tag.name.ilike(group_content.replace('*', '%'))) if '*' in group_content else Image.tags.any(Tag.name == group_content)
                    all_conditions.append(~condition if is_negative else condition)
            if all_conditions:
                query = query.filter(and_(*all_conditions))
    total = query.count()
    images = query.order_by(desc(Image.id)).offset((page - 1) * limit).limit(limit).all()
    result = [{"id": image.id, "filename": image.filename, "tags": sorted([tag.name for tag in image.tags])} for image in images]
    return JSONResponse({"images": result, "page": page, "limit": limit, "total": total, "has_more": (page * limit) < total})

@app.get("/api/tags/autocomplete")
def api_autocomplete_tags(q: Optional[str] = Query(None, min_length=1), limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    if not q: return []
    tags = db.query(Tag.name).filter(Tag.name.ilike(f"{q.strip().lower()}%")).order_by(Tag.name).limit(limit).all()
    return [tag[0] for tag in tags]

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
    images_before_state = {img.id: [tag.name for tag in img.tags] for img in images_to_update}
    try:
        with open(UNDO_STATE_FILE, 'w') as f:
            json.dump(images_before_state, f, indent=4)
    except IOError as e:
        # If we can't write the undo file, we shouldn't proceed with the action.
        raise HTTPException(status_code=500, detail=f"Could not save undo state: {e}")

    tag_names = {t.strip().lower() for t in tags.split(',') if t.strip()}
    
    if action in {"add", "replace"}:
        tags_for_action = get_or_create_tags(db, tag_names)

    for img in images_to_update:
        if action == "replace":
            img.tags = tags_for_action
        elif action == "add":
            current_tag_names = {tag.name for tag in img.tags}
            tags_to_append = [tag for tag in tags_for_action if tag.name not in current_tag_names]
            img.tags.extend(tags_to_append)
        elif action == "remove":
            img.tags = [tag for tag in img.tags if tag.name not in tag_names]
    
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
    
    all_tag_names_needed = {name for tag_list in images_before_state.values() for name in tag_list}
    tags_for_revert = {tag.name: tag for tag in db.query(Tag).filter(Tag.name.in_(all_tag_names_needed)).all()}

    images_to_revert = db.query(Image).filter(Image.id.in_(image_ids_to_revert)).all()

    for img in images_to_revert:
        # JSON keys are strings, so we must use string version of ID to look up.
        previous_tag_names = images_before_state.get(str(img.id), [])
        img.tags = [tags_for_revert[name] for name in previous_tag_names if name in tags_for_revert]
    
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
    tags_with_counts = (db.query(Tag, func.count(tags_table.c.image_id)).outerjoin(tags_table).group_by(Tag.id).order_by(Tag.name).all())
    untagged_count = db.query(Image).filter(~Image.tags.any()).count()
    tags_data = [{"id": tag.id, "name": tag.name, "count": count} for tag, count in tags_with_counts]
    return JSONResponse({"tags": tags_data, "untagged_count": untagged_count})

@app.post("/api/tags/force_delete/{tag_id}")
def api_force_delete_tag(tag_id: int, db: Session = Depends(get_db)):
    tag = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag: raise HTTPException(status_code=404, detail="Tag not found.")
    tag.images.clear()
    db.delete(tag)
    db.commit()
    return {"message": f"Tag '{tag.name}' and its associations were deleted."}

@app.post("/api/tags/rename/{tag_id}")
def api_rename_tag(tag_id: int, request: RenameTagRequest, db: Session = Depends(get_db)):
    tag_to_rename = db.query(Tag).filter(Tag.id == tag_id).first()
    if not tag_to_rename: raise HTTPException(status_code=404, detail="Tag to rename not found.")
    new_name_clean = request.new_name.strip().lower()
    if not new_name_clean: raise HTTPException(status_code=400, detail="New tag name cannot be empty.")
    if db.query(Tag).filter(Tag.name == new_name_clean).first(): raise HTTPException(status_code=400, detail=f"A tag named '{new_name_clean}' already exists.")
    tag_to_rename.name = new_name_clean
    db.commit()
    return {"message": f"Tag renamed to '{new_name_clean}'."}

@app.post("/api/tags/merge")
def api_merge_tags(tag_id_to_keep: int = Form(...), tag_id_to_delete: int = Form(...), db: Session = Depends(get_db)):
    if tag_id_to_keep == tag_id_to_delete: raise HTTPException(status_code=400, detail="Cannot merge a tag with itself.")
    tag_to_keep = db.query(Tag).filter(Tag.id == tag_id_to_keep).first()
    tag_to_delete = db.query(Tag).options(orm.selectinload(Tag.images)).filter(Tag.id == tag_id_to_delete).first()
    if not tag_to_keep or not tag_to_delete: raise HTTPException(status_code=404, detail="One or both tags were not found.")
    for image in tag_to_delete.images:
        if tag_to_keep not in image.tags: image.tags.append(tag_to_keep)
    tag_to_delete.images.clear()
    db.delete(tag_to_delete)
    db.commit()
    return {"message": f"Tag '{tag_to_delete.name}' merged into '{tag_to_keep.name}'."}

if __name__ == "__main__":
    import uvicorn
    # Change host to 127.0.0.1 if you don't want other devices in your LAN being able to access this app
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)