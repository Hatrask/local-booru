import os
import shutil

def factory_reset():
    """
    A standalone script to completely reset the application state.
    This should be run while the main FastAPI application is NOT running.
    """
    print("--- local-booru Factory Reset ---")
    print("\nIMPORTANT: Please ensure the main application server is stopped before proceeding.")
    print("\nWARNING: This will permanently delete all images and the database.")
    print("This action CANNOT be undone.")

    confirm = input("Type 'yes' to proceed with the reset: ")
    if confirm.lower() != 'yes':
        print("\nReset cancelled.")
        return

    print("-" * 20)

    # 1. Delete the database file
    db_file = 'database.db'
    if os.path.exists(db_file):
        try:
            os.remove(db_file)
            print(f"[OK] Deleted database file: {db_file}")
        except OSError as e:
            print(f"[ERROR] Could not delete database file: {e}")
            print("         Please make sure the application server is not running.")
            return

    # 2. Delete the undo state file
    undo_file = 'undo_state.json'
    if os.path.exists(undo_file):
        try:
            os.remove(undo_file)
            print(f"[OK] Deleted undo state file: {undo_file}")
        except OSError as e:
            print(f"[ERROR] Could not delete undo state file: {e}")
            # This is not a critical failure, so we can just warn and continue.
    
    # 3. Delete and recreate the media directory
    media_dir = 'media/images'
    if os.path.exists(media_dir):
        try:
            shutil.rmtree(media_dir)
            print(f"[OK] Deleted media directory: {media_dir}")
        except OSError as e:
            print(f"[ERROR] Could not delete media directory: {e}")
            return
    
    try:
        os.makedirs(media_dir, exist_ok=True)
        print(f"[OK] Recreated media directory: {media_dir}")
    except OSError as e:
        print(f"[ERROR] Could not recreate media directory: {e}")
        return

    print("-" * 20)
    print("\nReset complete. You can now start the main application.")
    print("The database will be recreated on the next run.")

if __name__ == "__main__":
    factory_reset()