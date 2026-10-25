"""Flask application for the local FITS data-cube viewer."""

from __future__ import annotations

import logging
import os
import re
import subprocess
from pathlib import Path
from typing import Any

import plotly
from flask import Flask, jsonify, render_template, request, send_file

from .cube import (
    CubeStore,
    ViewerError,
    describe_fits_file,
    open_local_cube,
)
from .lines import line_catalog


logger = logging.getLogger(__name__)


def _resolve_direct_fits_path(project_root: Path, supplied_path: str) -> Path:
    """Resolve a local WSL or Windows FITS path for direct memory mapping."""

    cleaned_path = supplied_path.strip().strip("\"'")
    if not cleaned_path:
        raise ViewerError("Enter a local FITS file path.")

    is_windows_path = bool(
        re.match(r"^[A-Za-z]:[\\/]", cleaned_path)
        or cleaned_path.startswith("\\\\")
    )
    if is_windows_path:
        try:
            converted = subprocess.run(
                ["wslpath", "-u", cleaned_path],
                capture_output=True,
                text=True,
                timeout=10,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise ViewerError("Could not convert the Windows file path.") from exc
        if converted.returncode != 0 or not converted.stdout.strip():
            raise ViewerError("Could not convert the Windows file path to WSL.")
        candidate = Path(converted.stdout.strip())
    else:
        candidate = Path(cleaned_path).expanduser()
        if not candidate.is_absolute():
            candidate = project_root / candidate

    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ViewerError(f"FITS file not found: {supplied_path}", 404) from exc

    if not resolved.is_file():
        raise ViewerError("The selected path is not a file.")
    if not resolved.name.lower().endswith((".fits", ".fit", ".fits.gz")):
        raise ViewerError("Choose a .fits, .fit, or .fits.gz file.")
    return resolved


def _candidate_search_roots(project_root: Path) -> list[Path]:
    configured_roots = os.environ.get("CUBE_VIEWER_SEARCH_ROOTS", "")
    if configured_roots.strip():
        roots = [
            Path(item).expanduser()
            for item in configured_roots.split(os.pathsep)
            if item.strip()
        ]
    else:
        roots = [
            project_root,
            project_root.parent,
            project_root.parent.parent,
            Path.home() / "Desktop",
            Path.home() / "Documents",
            Path.home() / "Downloads",
        ]

        windows_users = Path("/mnt/c/Users")
        if windows_users.is_dir():
            for user_directory in windows_users.iterdir():
                if not user_directory.is_dir():
                    continue
                for folder_name in ("Desktop", "Documents", "Downloads"):
                    candidate = user_directory / folder_name
                    if candidate.is_dir():
                        roots.append(candidate)
                roots.extend(user_directory.glob("OneDrive*"))

    unique_roots = []
    seen = set()
    for root in roots:
        try:
            resolved = root.resolve(strict=True)
        except (FileNotFoundError, OSError):
            continue
        if resolved not in seen:
            unique_roots.append(resolved)
            seen.add(resolved)
    return unique_roots


def _locate_selected_file(
    project_root: Path,
    filename: str,
    file_size: int,
    last_modified: float | None,
) -> Path:
    """Find the path of a browser-selected file without uploading its contents."""

    if Path(filename).name != filename or not filename:
        raise ViewerError("The selected filename is invalid.")
    if not filename.lower().endswith((".fits", ".fit", ".fits.gz")):
        raise ViewerError("Choose a .fits, .fit, or .fits.gz file.")

    target_name = filename.casefold()
    size_matches = []
    skipped_directories = {
        "AppData",
        "Application Data",
        "Library",
        "node_modules",
        "__pycache__",
        ".git",
        ".cache",
        "$Recycle.Bin",
    }
    for search_root in _candidate_search_roots(project_root):
        for current_root, directories, files in os.walk(search_root):
            directories[:] = [
                directory
                for directory in directories
                if directory not in skipped_directories
            ]
            for name in files:
                if name.casefold() != target_name:
                    continue
                candidate = Path(current_root) / name
                try:
                    candidate_stat = candidate.stat()
                except OSError:
                    continue
                if candidate_stat.st_size == file_size:
                    if (
                        last_modified is not None
                        and abs(candidate_stat.st_mtime - last_modified) <= 3.0
                    ):
                        return candidate.resolve()
                    size_matches.append((candidate.resolve(), candidate_stat.st_mtime))

    if not size_matches:
        raise ViewerError(
            "The selected file could not be matched to a local path. "
            "Use Open local path… and paste its path instead.",
            404,
        )
    if last_modified is not None:
        time_matches = [
            path
            for path, modified_time in size_matches
            if abs(modified_time - last_modified) <= 3.0
        ]
        if len(time_matches) == 1:
            return time_matches[0]
    if len(size_matches) == 1:
        return size_matches[0][0]
    raise ViewerError(
        "Multiple local files match the selected name and size. "
        "Use Open local path… to choose the exact path.",
        409,
    )


def _required_float(name: str) -> float:
    value = request.args.get(name)
    if value is None:
        raise ViewerError(f"Missing query parameter {name!r}.")
    try:
        return float(value)
    except ValueError as exc:
        raise ViewerError(f"Query parameter {name!r} must be a number.") from exc


def _json_safe_flux(flux):
    return [float(value) if value == value else None for value in flux]


def create_app(
    project_root: str | Path | None = None,
    cube_store: CubeStore | None = None,
) -> Flask:
    app = Flask(__name__)
    root = (
        Path(project_root).resolve()
        if project_root is not None
        else Path.cwd().resolve()
    )
    store = cube_store or CubeStore()
    app.config["PROJECT_ROOT"] = root
    app.config["CUBE_STORE"] = store

    @app.errorhandler(ViewerError)
    def handle_viewer_error(error: ViewerError):
        return jsonify({"error": error.message}), error.status_code

    def open_payload(cube):
        try:
            image = cube.default_image(statistic="median")
        except Exception:
            cube.close()
            raise
        store.add(cube)
        description = describe_fits_file(cube.path, cube.path.parent)
        return {
            "cube": cube.summary(),
            "image": cube.image_payload(image),
            "lines": list(line_catalog()),
            "source": {
                "path": str(cube.path.resolve()),
                "name": cube.path.name,
                "hdus": description["hdus"],
            },
        }

    @app.get("/")
    def index():
        return render_template("index.html")

    @app.get("/vendor/plotly.min.js")
    def plotly_bundle():
        plotly_bundle_path = (
            Path(plotly.__file__).resolve().parent
            / "package_data"
            / "plotly.min.js"
        )
        return send_file(
            plotly_bundle_path,
            mimetype="application/javascript",
            conditional=True,
        )

    @app.get("/api/health")
    def health():
        return jsonify({"status": "ok"})

    @app.post("/api/open-path")
    def open_direct_path():
        payload: dict[str, Any] = request.get_json(silent=False) or {}
        supplied_path = payload.get("path")
        if not isinstance(supplied_path, str) or not supplied_path.strip():
            raise ViewerError("Enter a local FITS file path.")

        hdu_value = payload.get("hdu")
        if hdu_value is None:
            hdu_index = None
        else:
            try:
                hdu_index = int(hdu_value)
            except (TypeError, ValueError) as exc:
                raise ViewerError("The HDU index must be an integer.") from exc

        path = _resolve_direct_fits_path(root, supplied_path)
        cube = open_local_cube(
            path=path,
            hdu_index=hdu_index,
            project_root=path.parent,
        )
        return jsonify(open_payload(cube))

    @app.post("/api/open-selected")
    def open_selected_file():
        payload: dict[str, Any] = request.get_json(silent=False) or {}
        filename = payload.get("name")
        file_size = payload.get("size")
        last_modified = payload.get("last_modified")
        if not isinstance(filename, str) or not filename:
            raise ViewerError("The browser did not provide a filename.")
        try:
            file_size = int(file_size)
        except (TypeError, ValueError) as exc:
            raise ViewerError("The browser did not provide a valid file size.") from exc
        if file_size < 0:
            raise ViewerError("The browser provided an invalid file size.")
        if last_modified is not None:
            try:
                last_modified = float(last_modified) / 1000.0
            except (TypeError, ValueError) as exc:
                raise ViewerError("The browser provided an invalid modification time.") from exc

        path = _locate_selected_file(
            root,
            filename,
            file_size,
            last_modified,
        )
        cube = open_local_cube(
            path=path,
            hdu_index=None,
            project_root=path.parent,
        )
        response = open_payload(cube)
        response["resolved_path"] = str(path)
        return jsonify(response)

    @app.get("/api/cubes/<cube_id>/image")
    def cube_image(cube_id: str):
        cube = store.get(cube_id)
        if cube.supports_spectrum:
            lambda_min = _required_float("lambda_min")
            lambda_max = _required_float("lambda_max")
            statistic = request.args.get("statistic", "median").lower()
            image = cube.collapse(lambda_min, lambda_max, statistic=statistic)
        else:
            try:
                band_index = int(request.args.get("band", 0))
            except ValueError as exc:
                raise ViewerError("The band index must be an integer.") from exc
            image = cube.band_image(band_index)
        return jsonify(cube.image_payload(image))

    @app.get("/api/cubes/<cube_id>/spectrum")
    def cube_spectrum(cube_id: str):
        cube = store.get(cube_id)
        x_value = request.args.get("x")
        y_value = request.args.get("y")
        if x_value is None or y_value is None:
            raise ViewerError("Both x and y pixel coordinates are required.")
        try:
            x = int(x_value)
            y = int(y_value)
        except ValueError as exc:
            raise ViewerError("Pixel coordinates must be integers.") from exc

        flux = cube.spectrum(x, y)
        return jsonify(
            {
                "x": x,
                "y": y,
                "wavelength": [float(value) for value in cube.wavelength],
                "wavelength_unit": cube.wavelength_unit,
                "flux": _json_safe_flux(flux),
            }
        )

    return app
