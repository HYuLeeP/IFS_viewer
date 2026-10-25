"""Run the local cube viewer with the Waitress WSGI server."""

import argparse
from pathlib import Path

from waitress import serve

from .app import create_app


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
    arguments = parser.parse_args(argv)
    if not 1 <= arguments.port <= 65535:
        parser.error("--port must be between 1 and 65535")

    data_root = arguments.data_root.expanduser().resolve()
    app = create_app(project_root=data_root)
    print(f"IFS_viewer running at http://{arguments.host}:{arguments.port}")
    print("Press Ctrl+C to stop.")
    serve(
        app,
        host=arguments.host,
        port=arguments.port,
        threads=4,
    )


if __name__ == "__main__":
    main()
