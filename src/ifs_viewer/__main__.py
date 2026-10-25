"""Run the local cube viewer with the Waitress WSGI server."""

import argparse
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

from waitress import serve

from .app import create_app


def _is_wsl() -> bool:
    if os.environ.get("WSL_DISTRO_NAME"):
        return True
    try:
        return "microsoft" in Path("/proc/sys/kernel/osrelease").read_text().lower()
    except OSError:
        return False


def _open_default_browser(url: str) -> bool:
    try:
        if _is_wsl() and shutil.which("powershell.exe"):
            subprocess.Popen(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-Command",
                    f"Start-Process '{url}'",
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return True
        if sys.platform == "darwin":
            subprocess.Popen(
                ["open", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return True
        if shutil.which("xdg-open"):
            subprocess.Popen(
                ["xdg-open", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                start_new_session=True,
            )
            return True
        return webbrowser.open(url, new=2)
    except (OSError, subprocess.SubprocessError):
        return False


def _open_browser_when_ready(host: str, port: int, url: str) -> None:
    connection_host = "127.0.0.1" if host in {"0.0.0.0", "::"} else host
    for _ in range(50):
        try:
            with socket.create_connection(
                (connection_host, port),
                timeout=0.1,
            ):
                break
        except OSError:
            time.sleep(0.1)
    else:
        print(f"Could not open the browser automatically. Open {url}")
        return
    if not _open_default_browser(url):
        print(f"Could not open the browser automatically. Open {url}")


def main(argv=None):
    parser = argparse.ArgumentParser(
        prog="IFS_viewer",
        description="Run the local IFS_viewer.",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host interface to bind (default: 127.0.0.1).",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8050,
        help="HTTP port to use (default: 8050).",
    )
    parser.add_argument(
        "--data-root",
        type=Path,
        default=Path.cwd(),
        help="Directory used for the initial FITS search root (default: cwd).",
    )
    parser.add_argument(
        "--no-open",
        action="store_true",
        help="Do not open the default browser automatically.",
    )
    arguments = parser.parse_args(argv)
    if not 1 <= arguments.port <= 65535:
        parser.error("--port must be between 1 and 65535")

    data_root = arguments.data_root.expanduser().resolve()
    app = create_app(project_root=data_root)
    display_host = (
        "127.0.0.1" if arguments.host in {"0.0.0.0", "::"} else arguments.host
    )
    url = f"http://{display_host}:{arguments.port}"
    print(f"IFS_viewer running at {url}")
    print("Press Ctrl+C to stop.")
    if not arguments.no_open:
        threading.Thread(
            target=_open_browser_when_ready,
            args=(arguments.host, arguments.port, url),
            daemon=True,
        ).start()
    serve(
        app,
        host=arguments.host,
        port=arguments.port,
        threads=4,
    )


if __name__ == "__main__":
    main()
