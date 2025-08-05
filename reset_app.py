#!/usr/bin/env python3
"""
Standalone script to perform a "factory reset" of the local-booru application.

WARNING: This is a destructive operation. It will permanently delete:
  - The entire SQLite database (`database.db`).
  - All uploaded images (`media/images/`).
  - The batch operation undo state file (`undo_state.json`).

This script should only be run when the main FastAPI server is NOT running to
avoid file lock errors. This action cannot be undone.
"""

import os
import shutil

# --- Configuration ---
# Define constants for all paths to be managed by the script.
DB_FILE = "database.db"
UNDO_STATE_FILE = "undo_state.json"
IMAGES_DIR = os.path.join("media", "images")


def factory_reset() -> None:
    """
    Guides the user through wiping all application data and restoring the
    directory structure to a clean state.
    """
    print("--- local-booru Factory Reset ---")
    print("\n" + "="*50)
    print("!! WARNING: DESTRUCTIVE OPERATION !!")
    print("="*50)
    print("This script will permanently delete all user data, including:")
    print(f"  - The database       ({DB_FILE})")
    print(f"  - All uploaded media ({IMAGES_DIR})")
    print(f"  - The undo-state file  ({UNDO_STATE_FILE})")
    print("\nThis action CANNOT be undone.")
    print("Please ensure the main application server is stopped before proceeding.")

    try:
        confirm = input("\n> To confirm, please type 'reset my booru': ")
        if confirm.lower() != 'reset my booru':
            print("\nConfirmation failed. Reset has been cancelled.")
            return
    except (KeyboardInterrupt, EOFError):
        print("\n\nReset cancelled by user.")
        return

    print("\n--- Starting Reset Process ---")

    # A list of files and directories to delete.
    items_to_delete = [
        {"path": DB_FILE, "type": "file"},
        {"path": UNDO_STATE_FILE, "type": "file"},
        {"path": IMAGES_DIR, "type": "directory"},
    ]

    errors_occurred = False
    for item in items_to_delete:
        path = item["path"]
        item_type = item["type"]
        print(f"Checking for {item_type} '{path}'...")

        if not os.path.exists(path):
            print(f"  - [INFO] Already gone. Skipping.")
            continue

        try:
            if item_type == "file":
                os.remove(path)
            elif item_type == "directory":
                shutil.rmtree(path)
            print(f"  - [SUCCESS] Deleted {item_type}.")
        except OSError as e:
            print(f"  - [ERROR] Could not delete {item_type}. Reason: {e}")
            print("    Please check file permissions and ensure the server is not running.")
            errors_occurred = True

    # Recreate the essential media directory.
    print(f"\nEnsuring '{IMAGES_DIR}' directory exists...")
    try:
        os.makedirs(IMAGES_DIR, exist_ok=True)
        print("  - [SUCCESS] Directory is ready.")
    except OSError as e:
        print(f"  - [ERROR] Could not create directory. Reason: {e}")
        errors_occurred = True

    print("\n--- Reset Process Finished ---")
    if errors_occurred:
        print("\n[FAILED] The reset process completed with one or more errors.")
        print("Please review the messages above.")
    else:
        print("\n[SUCCESS] The application has been reset to a clean state.")
        print("You may now start the server. The database will be created on first run.")


if __name__ == "__main__":
    factory_reset()