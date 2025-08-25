import shutil
import os
import uuid
import json
import tempfile
import zipfile
import asyncio
import io
import requests
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import UploadFile, File, Form, Request, Depends, Query, HTTPException
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from pydantic import BaseModel, ValidationError
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import desc, func, or_, and_, text

# Import app components from the app package
from . import app, templates, get_db, MEDIA_DIR, THUMBNAIL_DIR, UNDO_STATE_FILE, PROJECT_ROOT
from .database import Image, Tag, tags_table
from .utils import (
    calculate_sha256,
    get_or_create_tags,
    get_nested_path_for_filename,
    create_thumbnail,
    VALID_CATEGORIES
)

# --- Pydantic Models ---
class RenameTagRequest(BaseModel):
    new_name: str

class ChangeCategoryRequest(BaseModel):
    new_category: str

class UpdateTagsRequest(BaseModel):
    tags: List[str] = []

class UploadFromUrlRequest(BaseModel):
    image_url: str
    tags: List[str] = []

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

def _process_and_save_file(file: UploadFile, tag_names: set, get_db_func) -> bool:
    """
    This function runs in a separate thread and handles the entire lifecycle
    of processing and saving a single file. It uses its own database session.
    """
    db = next(get_db_func())
    try:
        if not file.content_type or not file.content_type.startswith("image/"):
            return False

        file.file.seek(0)
        file_hash = calculate_sha256(file.file)

        if db.query(Image).filter(Image.sha256_hash == file_hash).first():
            return True # Treat as success if already exists

        subtype = file.content_type.split('/')[-1]
        extension = os.path.splitext(file.filename)[1].lstrip('.') or subtype or "jpg"
        
        unique_filename = f"{uuid.uuid4().hex}.{extension}"
        nested_path = get_nested_path_for_filename(unique_filename)
        
        image_dest_dir = os.path.join(MEDIA_DIR, "images", nested_path)
        thumbnail_dest_dir = os.path.join(THUMBNAIL_DIR, nested_path)
        os.makedirs(image_dest_dir, exist_ok=True)
        os.makedirs(thumbnail_dest_dir, exist_ok=True)

        path = os.path.join(image_dest_dir, unique_filename)
        
        file.file.seek(0)
        with open(path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        thumbnail_filename = f"{os.path.splitext(unique_filename)[0]}.jpg"
        thumbnail_path = os.path.join(thumbnail_dest_dir, thumbnail_filename)
        create_thumbnail(path, thumbnail_path)

        tags_to_add = get_or_create_tags(db, tag_names)
        
        image = Image(filename=unique_filename, sha256_hash=file_hash, tags=tags_to_add)
        db.add(image)
        db.commit()
        
        return True
    except Exception as e:
        db.rollback()
        print(f"ERROR: Thread failed to process file '{file.filename}'. Reason: {e}")
        return False
    finally:
        file.file.close()
        db.close()

@app.post("/upload")
async def upload_images(
    files: List[UploadFile] = File(...),
    tags: str = Form(""),
    get_db_func: Session = Depends(get_db),
):
    tag_names = {t.strip().lower() for t in tags.split(',') if t.strip()}
    
    tasks = [
        run_in_threadpool(_process_and_save_file, file, tag_names, get_db)
        for file in files
    ]
    results = await asyncio.gather(*tasks)
    
    uploaded_count = sum(1 for r in results if r)
    failed_count = len(results) - uploaded_count
    
    message = f"Upload complete. {uploaded_count} file(s) succeeded, {failed_count} failed."
    return JSONResponse(
        {
            "message": message,
            "uploaded_count": uploaded_count,
            "failed_count": failed_count,
            "failed_files": []
        },
        status_code=200
    )

@app.post("/api/upload_from_url")
async def api_upload_from_url(request: UploadFromUrlRequest, db: Session = Depends(get_db)):
    """
    Downloads an image from a URL, processes it, and adds it to the gallery.
    This is designed to be used by the browser extension.
    """

    # This function contains the core logic and will be run in a thread to avoid blocking the server
    def _download_and_process():
        try:
            # 1. Download the image from the provided URL
            response = requests.get(request.image_url, stream=True, timeout=30)
            response.raise_for_status()  # Raise an HTTPError for bad responses (4xx or 5xx)

            content_type = response.headers.get('content-type')
            if not content_type or not content_type.startswith("image/"):
                raise HTTPException(status_code=400, detail=f"URL did not point to a valid image. Content-Type: {content_type}")

            image_bytes = response.content
            # Use an in-memory stream for processing
            image_stream = io.BytesIO(image_bytes)
            
            # 2. Calculate the image hash and check if it already exists
            file_hash = calculate_sha256(image_stream)
            image_stream.seek(0)  # Reset stream position for the next read

            if db.query(Image).filter(Image.sha256_hash == file_hash).first():
                return {"message": "Image already exists in the gallery.", "status": "duplicate"}

            # 3. Determine filename and save the image and its thumbnail
            subtype = content_type.split('/')[-1]
            path_ext = os.path.splitext(request.image_url)[1].lstrip('.')
            extension = path_ext or subtype or "jpg"
            
            unique_filename = f"{uuid.uuid4().hex}.{extension}"
            nested_path = get_nested_path_for_filename(unique_filename)
            
            image_dest_dir = os.path.join(MEDIA_DIR, "images", nested_path)
            thumbnail_dest_dir = os.path.join(THUMBNAIL_DIR, nested_path)
            os.makedirs(image_dest_dir, exist_ok=True)
            os.makedirs(thumbnail_dest_dir, exist_ok=True)

            path = os.path.join(image_dest_dir, unique_filename)
            
            with open(path, "wb") as buffer:
                buffer.write(image_bytes)

            thumbnail_filename = f"{os.path.splitext(unique_filename)[0]}.jpg"
            thumbnail_path = os.path.join(thumbnail_dest_dir, thumbnail_filename)
            create_thumbnail(path, thumbnail_path)

            # 4. Parse and retrieve/create the tags
            tag_names = {t.strip().lower() for t in request.tags if t.strip()}
            tags_to_add = get_or_create_tags(db, tag_names)
            
            # 5. Create the new image record in the database
            new_image = Image(filename=unique_filename, sha256_hash=file_hash, tags=tags_to_add)
            db.add(new_image)
            db.commit()
            
            return {"message": f"Image from URL uploaded successfully.", "status": "success"}

        except requests.exceptions.RequestException as e:
            raise HTTPException(status_code=502, detail=f"Failed to download image from URL. Reason: {e}")
        except Exception as e:
            db.rollback()
            # This handles other potential errors like filesystem permissions
            raise HTTPException(status_code=500, detail=f"An internal error occurred: {e}")

    # Use FastAPI's run_in_threadpool to handle the blocking I/O (download, file saving)
    result = await run_in_threadpool(_download_and_process)

    if result["status"] == "duplicate":
        return JSONResponse({"message": result["message"]}, status_code=200)
    
    return JSONResponse({"message": result["message"]}, status_code=201)

# This new endpoint replaces the old form-based /retag/{image_id} route.
# It accepts a JSON body, making it suitable for modern frontend interactions.
@app.put("/api/image/{image_id}/tags")
def api_update_image_tags(image_id: int, request: UpdateTagsRequest, db: Session = Depends(get_db)):
    """
    Replaces all tags on a single image. Designed for the new lightbox editor.
    This has been optimized to perform a diff, only adding or removing tags
    that have changed, which is much more efficient than replacing the entire set.
    """
    image = db.query(Image).options(selectinload(Image.tags)).filter(Image.id == image_id).first()
    if not image:
        raise HTTPException(status_code=404, detail="Image not found")
    
    # The frontend sends a list of raw tag strings (e.g., "artist:someone", "general_tag")
    tag_names = {t.strip().lower() for t in request.tags if t.strip()}
    
    # Get Tag objects for the new set of tags, creating any that don't exist.
    new_tags_list = get_or_create_tags(db, tag_names)

    # --- Efficiently update tags by comparing current and new sets ---
    # By converting the tag lists to sets, we can quickly find the difference.
    new_tags_set = set(new_tags_list)
    current_tags_set = set(image.tags)

    tags_to_add = new_tags_set - current_tags_set
    tags_to_remove = current_tags_set - new_tags_set

    # Perform the append/remove operations. SQLAlchemy's ORM handles the
    # underlying INSERT and DELETE statements on the association table.
    for tag in tags_to_add:
        image.tags.append(tag)
    
    for tag in tags_to_remove:
        image.tags.remove(tag)

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
    query = db.query(Image).options(selectinload(Image.tags))
    if q:
        q_clean = q.strip().lower()
        if q_clean == 'untagged':
            query = query.filter(~Image.tags.any())
        else:
            q_processed = q_clean.replace(' and ', ',')
            and_groups = [group.strip() for group in q_processed.split(',') if group.strip()]
            all_conditions = []
            for group in and_groups:
                # To handle 'tag1 or tag2' without parentheses, we can dynamically wrap it
                # to leverage the existing parenthesized-group logic.
                temp_group = group
                if ' or ' in temp_group and not (temp_group.startswith('(') and temp_group.endswith(')')):
                    temp_group = f"({temp_group})"

                is_negative = temp_group.startswith('-')
                group_content = temp_group[1:] if is_negative else temp_group
                
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
                        
                        if or_conditions:
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
    # It also constructs the full nested path for the frontend.
    result = []
    for image in images:
        filename = image.filename
        nested_path = get_nested_path_for_filename(filename)
        
        # We use os.path.join and then replace backslashes to ensure cross-platform URL compatibility.
        full_filename_path = os.path.join(nested_path, filename).replace('\\', '/')
        
        result.append({
            "id": image.id, 
            "filename": full_filename_path, 
            "tags": sorted([{"name": tag.name, "category": tag.category} for tag in image.tags], key=lambda t: (t['category'], t['name']))
        })

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
        # Get the nested path to locate the file on disk
        nested_path = get_nested_path_for_filename(image.filename)
        
        # Delete original image
        image_path = os.path.join(MEDIA_DIR, "images", nested_path, image.filename)
        if os.path.exists(image_path): os.remove(image_path)
        
        # Delete thumbnail
        thumbnail_filename = f"{os.path.splitext(image.filename)[0]}.jpg"
        thumbnail_path = os.path.join(THUMBNAIL_DIR, nested_path, thumbnail_filename)
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

    # Get the nested path to locate the file on disk
    nested_path = get_nested_path_for_filename(image.filename)

    # Delete original image
    image_path = os.path.join(MEDIA_DIR, "images", nested_path, image.filename)
    if os.path.exists(image_path):
        os.remove(image_path)

    # Delete thumbnail
    thumbnail_filename = f"{os.path.splitext(image.filename)[0]}.jpg"
    thumbnail_path = os.path.join(THUMBNAIL_DIR, nested_path, thumbnail_filename)
    if os.path.exists(thumbnail_path):
        os.remove(thumbnail_path)

    db.delete(image)
    db.commit()
    return {"message": f"Successfully deleted image {image_id}."}


@app.post("/api/images/batch_retag")
def batch_retag(
    image_ids: List[int] = Form(...),
    tags: str = Form(""),
    action: str = Form(...),
    db: Session = Depends(get_db),
):
    """
    Performs a tag operation (add, remove, or replace) on a batch of images.
    Saves the 'before' state to a file for persistent undo.
    This version is optimized to only perform necessary INSERT/DELETE operations.
    """
    if action not in {"add", "remove", "replace"}:
        raise HTTPException(status_code=400, detail="Invalid action specified.")
    if not image_ids:
        raise HTTPException(status_code=400, detail="No image IDs provided.")

    images_to_update = db.query(Image).filter(Image.id.in_(image_ids)).options(selectinload(Image.tags)).all()
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
    
    # Get/create all tags involved in this operation up front.
    tags_for_action = get_or_create_tags(db, raw_tag_inputs)
    
    for img in images_to_update:
        current_tags_set = set(img.tags)
        
        if action == "replace":
            # For 'replace', we do a full diff to add/remove as needed.
            new_tags_set = set(tags_for_action)
            tags_to_add = new_tags_set - current_tags_set
            tags_to_remove = current_tags_set - new_tags_set
            
            for tag in tags_to_add:
                img.tags.append(tag)
            for tag in tags_to_remove:
                img.tags.remove(tag)

        elif action == "add":
            # For 'add', we only append tags that are not already present.
            for tag in tags_for_action:
                if tag not in current_tags_set:
                    img.tags.append(tag)

        elif action == "remove":
            # For 'remove', we only remove tags that are actually present.
            # This is more efficient than rebuilding the entire list.
            for tag in tags_for_action:
                if tag in current_tags_set:
                    img.tags.remove(tag)
    
    db.commit()
    return JSONResponse({"message": "Batch tags updated successfully."})

@app.post("/api/images/batch_undo")
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

@app.get("/api/tags/search")
def api_search_tags(
    q: Optional[str] = Query(None),
    orphans_only: bool = Query(False),
    sort_by: str = Query('name', enum=['name', 'count']),
    page: int = Query(1, ge=1),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(get_db)
):
    """
    Provides a paginated and searchable list of tags with their usage counts.
    This is the primary endpoint for the new Tag Manager.
    """
    # Base query with a subquery to get the image count for each tag.
    subquery = (
        db.query(tags_table.c.tag_id, func.count(tags_table.c.image_id).label("image_count"))
        .group_by(tags_table.c.tag_id)
        .subquery()
    )
    
    query = db.query(Tag, func.coalesce(subquery.c.image_count, 0).label("count")) \
              .outerjoin(subquery, Tag.id == subquery.c.tag_id)

    # Apply filters
    if q:
        query_str = q.strip().lower()
        if ':' in query_str:
            category, name_part = query_str.split(':', 1)
            if category in VALID_CATEGORIES:
                query = query.filter(Tag.category == category, Tag.name.ilike(f"%{name_part}%"))
            else:
                 query = query.filter(Tag.name.ilike(f"%{query_str}%"))
        else:
            query = query.filter(Tag.name.ilike(f"%{q}%"))

    if orphans_only:
        query = query.filter(subquery.c.image_count == None)
        # Also exclude the 'metadata:favorite' tag from the orphan list.
        query = query.filter(~and_(Tag.category == 'metadata', Tag.name == 'favorite'))

    # Apply sorting
    if sort_by == 'name':
        query = query.order_by(Tag.category, Tag.name)
    else: # sort_by == 'count'
        query = query.order_by(desc("count"), Tag.name)

    total = query.count()
    tags_with_counts = query.offset((page - 1) * limit).limit(limit).all()

    tags_data = [
        {"id": tag.id, "name": tag.name, "category": tag.category, "count": count}
        for tag, count in tags_with_counts
    ]
    
    return JSONResponse({
        "tags": tags_data,
        "page": page,
        "limit": limit,
        "total": total,
        "has_more": (page * limit) < total
    })


@app.post("/api/tags/delete_orphans")
def api_delete_orphan_tags(db: Session = Depends(get_db)):
    """
    Finds and deletes all tags that are not associated with any images.
    It deliberately excludes the 'metadata:favorite' tag.
    """
    orphan_tags_query = (
        db.query(Tag)
        .filter(~Tag.images.any())
        .filter(~and_(Tag.name == 'favorite', Tag.category == 'metadata'))
    )
    
    orphan_tags = orphan_tags_query.all()
    deleted_count = len(orphan_tags)

    if deleted_count > 0:
        for tag in orphan_tags:
            db.delete(tag)
        db.commit()

    return JSONResponse({"message": f"Successfully deleted {deleted_count} orphan tag(s)."})

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
    """
    Merges one tag into another. This implementation uses raw SQL for high
    performance, especially when dealing with tags that have a very large
    number of associated images. It avoids loading all images into memory.
    """
    if tag_id_to_keep == tag_id_to_delete:
        raise HTTPException(status_code=400, detail="Cannot merge a tag with itself.")
    
    tag_to_keep = db.query(Tag).filter(Tag.id == tag_id_to_keep).first()
    tag_to_delete = db.query(Tag).filter(Tag.id == tag_id_to_delete).first()
    
    if not tag_to_keep or not tag_to_delete:
        raise HTTPException(status_code=404, detail="One or both tags were not found.")
    
    insert_stmt = text("""
        INSERT INTO image_tags (image_id, tag_id)
        SELECT image_id, :tag_id_to_keep
        FROM image_tags
        WHERE tag_id = :tag_id_to_delete
        ON CONFLICT(image_id, tag_id) DO NOTHING
    """)
    db.execute(insert_stmt, {"tag_id_to_keep": tag_id_to_keep, "tag_id_to_delete": tag_id_to_delete})
    
    tag_to_keep.last_used_at = datetime.now(timezone.utc)
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
    all_images = db.query(Image).options(selectinload(Image.tags)).order_by(Image.id).all()
    
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
                # Find the source file in its nested directory
                filename = image_meta["filename"]
                nested_path = get_nested_path_for_filename(filename)
                source_path = os.path.join(images_dir, nested_path, filename)
                
                # The archive path remains flat to ensure import compatibility
                archive_path = os.path.join("images", filename)
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
        with open(os.path.join(PROJECT_ROOT, ".reset_pending"), "w") as f:
            f.write("reset")
    except IOError as e:
        raise HTTPException(status_code=500, detail=f"Could not schedule reset. Reason: {e}")

    return JSONResponse({"message": "Reset has been scheduled. Please stop and restart the application server to complete the process."})

@app.post("/api/import_collection")
async def api_import_collection(file: UploadFile = File(...), db: Session = Depends(get_db)):
    """
    Imports a collection from a previously exported .zip file.
    ...
    4. For each new image, it copies the image file AND generates a new thumbnail into a nested directory structure.
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
            
            # 3. Copy the physical image file into a nested directory structure.
            filename = image_data['filename']
            source_image_path = os.path.join(images_dir_path, filename)
            
            if not os.path.exists(source_image_path):
                continue # Skip if the image file is missing from the archive
            
            nested_path = get_nested_path_for_filename(filename)
            dest_image_dir = os.path.join(MEDIA_DIR, "images", nested_path)
            os.makedirs(dest_image_dir, exist_ok=True)
            dest_image_path = os.path.join(dest_image_dir, filename)
            shutil.copy(source_image_path, dest_image_path)
            
            # 4. Generate thumbnail for the newly imported image in its own nested directory.
            thumbnail_filename = f"{os.path.splitext(filename)[0]}.jpg"
            thumbnail_dest_dir = os.path.join(THUMBNAIL_DIR, nested_path)
            os.makedirs(thumbnail_dest_dir, exist_ok=True)
            thumbnail_path = os.path.join(thumbnail_dest_dir, thumbnail_filename)
            create_thumbnail(dest_image_path, thumbnail_path)
            
            # 5. Get or create tags for the new image.
            raw_tags = set(image_data.get('tags', []))
            tags_for_image = get_or_create_tags(db, raw_tags)
            
            # 6. Create the new Image database record.
            new_image = Image(
                filename=filename,
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