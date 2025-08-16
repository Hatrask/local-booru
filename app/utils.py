import hashlib
import os
from datetime import datetime, timezone
from typing import IO, List, Dict
from PIL import Image as PILImage
from sqlalchemy.orm import Session

# Import models for type hinting and querying
from .database import Tag

# This constant is used by get_or_create_tags
VALID_CATEGORIES = {"general", "artist", "character", "copyright", "metadata"}

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
    now = datetime.now(timezone.utc)
    for tag in tags_to_process:
        tag.last_used_at = now
            
    return tags_to_process

def get_nested_path_for_filename(filename: str) -> str:
    """
    Generates a nested directory path from the first four characters of a filename's stem.
    A filename like 'd41d8cd98f00b204e9800998ecf8427e.jpg' results in 'd4/1d'.
    This helps to avoid having too many files in a single directory.
    """
    # os.path.splitext() splits 'filename.ext' into ('filename', '.ext')
    name_part = os.path.splitext(filename)[0]
    if len(name_part) < 4:
        return "" # Return empty for very short names to avoid errors
    # Use the first two characters for the top-level directory, and the next two for the second-level.
    return os.path.join(name_part[:2], name_part[2:4])

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