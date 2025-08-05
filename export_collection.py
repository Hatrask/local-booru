#!/usr/bin/env python3
"""
Standalone command-line script to export all data from a local-booru instance.

This script connects directly to the SQLite database, reads all image and tag
information, and creates a single distributable zip file containing:
  1. A `metadata.json` file with all image hashes and their associated tags.
  2. An `images/` folder containing all the physical image files.

This allows a user to create a complete, portable backup of their collection.
"""

import sqlite3
import json
import os
import zipfile
import argparse
from datetime import datetime, timezone
from tqdm import tqdm
from typing import List, Dict, Any

# --- Configuration ---
# Paths are relative to where the script is run.
DB_PATH = "database.db"
IMAGES_DIR = os.path.join("media", "images")
DEFAULT_EXPORT_FILENAME = "booru_export.zip"

# Import the FastAPI app instance from main.py to use its version as a
# single source of truth. A fallback is used if the import fails.
try:
    from main import app as fastapiapp
    APP_VERSION = fastapiapp.version
except (ImportError, ModuleNotFoundError):
    print("Warning: Could not import 'main.py' to get version. Using 'unknown'.")
    APP_VERSION = "unknown"


def fetch_all_image_metadata(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    """
    Queries the database to get all images and their aggregated tags.

    This uses GROUP_CONCAT to efficiently fetch all tags for each image in a
    single row, improving performance over processing tags row-by-row in Python.

    Returns:
        A list of dictionaries, where each dictionary represents an image and
        its metadata.
    """
    print("Querying database for all image metadata...")

    sql_query = """
    SELECT
        i.filename,
        i.sha256_hash,
        GROUP_CONCAT(t.name)
    FROM
        images i
    LEFT JOIN image_tags it ON i.id = it.image_id
    LEFT JOIN tags t ON it.tag_id = t.id
    GROUP BY
        i.id
    ORDER BY
        i.id;
    """

    all_images = []
    cursor = conn.cursor()
    cursor.execute(sql_query)

    for filename, sha256_hash, concatenated_tags in cursor.fetchall():
        # If an image has no tags, GROUP_CONCAT returns NULL.
        if concatenated_tags:
            tags = sorted(concatenated_tags.split(','))
        else:
            tags = []

        all_images.append({
            "filename": filename,
            "sha256_hash": sha256_hash,
            "tags": tags
        })

    print(f"Found metadata for {len(all_images)} images.")
    return all_images


def create_export_archive(images_metadata: list, output_path: str) -> bool:
    """
    Creates a zip archive from the provided image metadata.

    The archive will contain a metadata.json file and all physical image files.
    """
    print(f"Creating export archive at '{output_path}'...")

    final_metadata = {
        "app_version": APP_VERSION,
        "export_date": datetime.now(timezone.utc).isoformat(),
        "images": images_metadata
    }

    try:
        with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            zipf.writestr("metadata.json", json.dumps(final_metadata, indent=4))

            print("Adding image files to the archive...")
            for image_meta in tqdm(images_metadata, desc="Zipping images"):
                image_filename = image_meta["filename"]
                source_path = os.path.join(IMAGES_DIR, image_filename)
                archive_path = os.path.join("images", image_filename)

                if os.path.exists(source_path):
                    zipf.write(source_path, archive_path)
                else:
                    tqdm.write(f"Warning: Image file not found on disk, skipping: {source_path}")

    except IOError as e:
        print(f"\nError: Could not write to file '{output_path}'. Reason: {e}")
        return False
    except Exception as e:
        print(f"\nAn unexpected error occurred during zip creation: {e}")
        return False

    return True


def main() -> None:
    """Main function to orchestrate the export process."""
    print("--- local-booru Exporter ---")
    parser = argparse.ArgumentParser(
        description="Creates a zip archive of all images and tags from the local-booru database.",
        formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument(
        "-o", "--output",
        default=DEFAULT_EXPORT_FILENAME,
        help=f"Path for the output zip file.\n(default: {DEFAULT_EXPORT_FILENAME})"
    )
    args = parser.parse_args()

    # Pre-flight checks for necessary files and directories.
    if not os.path.exists(DB_PATH):
        print(f"Error: Database file not found at '{DB_PATH}'.")
        print("Please run this script from the application's root directory.")
        return
    if not os.path.isdir(IMAGES_DIR):
        print(f"Error: Images directory not found at '{IMAGES_DIR}'.")
        return

    conn = None
    try:
        conn = sqlite3.connect(DB_PATH)
        all_images_metadata = fetch_all_image_metadata(conn)

        if not all_images_metadata:
            print("No images found in the database. Nothing to export.")
            return

        if create_export_archive(all_images_metadata, args.output):
            print("\n-----------------------------")
            print(" Export completed successfully!")
            print(f" Your collection is saved to: {os.path.abspath(args.output)}")
            print("-----------------------------")

    except sqlite3.Error as e:
        print(f"A database error occurred: {e}")
    finally:
        if conn:
            conn.close()


if __name__ == "__main__":
    main()