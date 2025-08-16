import uvicorn
import sys
import os

from app import app

if __name__ == "__main__":
    # This check is crucial for distinguishing between development and packaged mode
    is_packaged = getattr(sys, 'frozen', False)

    if is_packaged:
        # Running in a PyInstaller bundle.
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=8000
            # reload is False by default
        )
    else:
        # Running as a standard Python script.
        # Change host to 127.0.0.1 if you don't want other devices in your LAN being able to access the gallery
        uvicorn.run(
            "app:app",
            host="0.0.0.0",
            port=8000,
            reload=True
        )