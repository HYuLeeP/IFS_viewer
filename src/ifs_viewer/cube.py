"""Read-only access to FITS spectral cubes and long-slit spectra."""

from __future__ import annotations

import warnings
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from threading import RLock
from typing import Any
from uuid import uuid4

import numpy as np
from astropy.io import fits
from astropy.wcs import WCS


_SPECTRAL_CTYPE_TOKENS = (
    "WAVE",
    "FREQ",
    "VELO",
    "ENER",
    "AWAV",
    "WAVELOG",
)

_BAND_CTYPE_TOKENS = (
    "FILTER",
    "BAND",
    "STOKES",
)


class ViewerError(Exception):
    """An error that can be shown directly to the viewer's user."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _is_fits_path(path: Path) -> bool:
    name = path.name.lower()
    return name.endswith((".fits", ".fit", ".fits.gz"))


def _is_spectral_axis(header: fits.Header, axis_number: int) -> bool:
    ctype = str(header.get(f"CTYPE{axis_number}", "")).upper()
    return any(token in ctype for token in _SPECTRAL_CTYPE_TOKENS)


@dataclass(frozen=True)
class LayoutInfo:
    kind: str
    spectral_axis_fits: int | None
    spectral_axis_numpy: int | None
    band_axis_numpy: int | None
    note: str


def _infer_layout(
    header: fits.Header,
    shape: tuple[int, ...],
) -> LayoutInfo:
    """Identify a spectral cube, long slit, image, or band stack."""

    if len(shape) == 3:
        for axis_number in (3, 2, 1):
            if _is_spectral_axis(header, axis_number):
                return LayoutInfo(
                    kind="spectral_cube",
                    spectral_axis_fits=axis_number,
                    spectral_axis_numpy=len(shape) - axis_number,
                    band_axis_numpy=None,
                    note="FITS spectral WCS axis",
                )

        for axis_number in (3, 2, 1):
            ctype = str(header.get(f"CTYPE{axis_number}", "")).upper()
            if any(token in ctype for token in _BAND_CTYPE_TOKENS):
                return LayoutInfo(
                    kind="band_stack",
                    spectral_axis_fits=None,
                    spectral_axis_numpy=None,
                    band_axis_numpy=len(shape) - axis_number,
                    note="FITS band/filter WCS axis",
                )

        dimension_lengths = np.asarray(shape)
        band_axis = int(np.argmin(dimension_lengths))
        if dimension_lengths[band_axis] * 3 >= np.median(dimension_lengths):
            band_axis = 0
        return LayoutInfo(
            kind="band_stack",
            spectral_axis_fits=None,
            spectral_axis_numpy=None,
            band_axis_numpy=band_axis,
            note="Unlabeled 3D image stack interpreted as bands",
        )
    elif len(shape) == 2:
        for axis_number in (1, 2):
            if _is_spectral_axis(header, axis_number):
                return LayoutInfo(
                    kind="long_slit",
                    spectral_axis_fits=axis_number,
                    spectral_axis_numpy=len(shape) - axis_number,
                    band_axis_numpy=None,
                    note="FITS spectral WCS axis",
                )

        # The supplied WiFeS long-slit file stores wavelength first, but its
        # inherited header still describes that axis as FITS axis 3.
        has_axis3_wave = _is_spectral_axis(header, 3)
        has_axis3_scale = "CRVAL3" in header and "CDELT3" in header
        if has_axis3_wave and has_axis3_scale and shape[0] > shape[1]:
            return LayoutInfo(
                kind="long_slit",
                spectral_axis_fits=3,
                spectral_axis_numpy=0,
                band_axis_numpy=None,
                note="Spectral-first long-slit fallback",
            )

        return LayoutInfo(
            kind="image",
            spectral_axis_fits=None,
            spectral_axis_numpy=None,
            band_axis_numpy=None,
            note="Two-dimensional image",
        )

    raise ViewerError("Only 2D images and 3D cubes or image stacks are supported.")


def _to_angstrom(
    values: np.ndarray,
    header: fits.Header,
    spectral_axis: int,
    unit_override: str | None = None,
) -> tuple[np.ndarray, str, str | None]:
    """Convert linear spectral coordinates to Angstrom."""

    values = np.asarray(values, dtype=float)
    unit_label = (
        unit_override
        if unit_override
        else str(header.get(f"CUNIT{spectral_axis}", "")).strip()
    )
    unit_lower = unit_label.lower().replace(" ", "")

    if unit_lower in {"angstrom", "angstroms", "ang", "aa", "a"}:
        return values, "Angstrom", None
    if unit_lower in {"nm", "nanometer", "nanometers"}:
        return values * 10.0, "Angstrom", None
    if unit_lower in {"micron", "microns", "um", "µm"}:
        return values * 1.0e4, "Angstrom", None
    if unit_lower in {"m", "meter", "meters"}:
        if values.size and np.nanmax(np.abs(values)) < 1.0e-3:
            return values * 1.0e10, "Angstrom", None

    # The supplied files omit CUNIT. Their raw WAVE values are optical
    # Angstroms even though Astropy reports the FITS default unit as metres.
    finite_values = values[np.isfinite(values)]
    if finite_values.size and np.min(finite_values) > 100.0:
        return values, "Angstrom", (
            f"CUNIT{spectral_axis} is missing; the optical WAVE values were "
            "interpreted as Angstrom."
        )

    raise ViewerError(
        f"Unsupported spectral unit {unit_label!r}; expected Angstrom, nm, micron, or metre."
    )


def _spectral_wavelength(
    header: fits.Header,
    spectral_axis: int,
    length: int,
    data_ndim: int,
) -> tuple[np.ndarray, str, str | None]:
    pixels = np.arange(length, dtype=float)
    has_wcs_matrix = any(
        ("_" in str(key) and str(key).startswith(("CD", "PC")))
        for key in header
    )

    if (
        not has_wcs_matrix
        and f"CRVAL{spectral_axis}" in header
        and f"CDELT{spectral_axis}" in header
    ):
        reference_pixel = float(header.get(f"CRPIX{spectral_axis}", 1.0))
        reference_value = float(header[f"CRVAL{spectral_axis}"])
        step = float(header[f"CDELT{spectral_axis}"])
        raw_wavelength = (
            reference_value
            + (pixels - (reference_pixel - 1.0)) * step
        )
        return _to_angstrom(raw_wavelength, header, spectral_axis)

    if spectral_axis <= data_ndim:
        try:
            wcs = WCS(header, naxis=data_ndim)
            pixel_coordinates = [np.zeros(length, dtype=float) for _ in range(data_ndim)]
            pixel_coordinates[spectral_axis - 1] = pixels
            world_coordinates = wcs.pixel_to_world_values(*pixel_coordinates)
            raw_wavelength = np.asarray(
                world_coordinates[spectral_axis - 1],
                dtype=float,
            )
            unit = (
                wcs.world_axis_units[spectral_axis - 1]
                or str(header.get(f"CUNIT{spectral_axis}", ""))
            )
            if raw_wavelength.size == length and np.all(np.isfinite(raw_wavelength)):
                return _to_angstrom(
                    raw_wavelength,
                    header,
                    spectral_axis,
                    unit_override=unit,
                )
        except Exception:
            # Some spectral-first 2D products carry axis-3 cards even though
            # their FITS header has only two axes. The linear fallback handles
            # that common malformed layout.
            pass

    for key in ("CRVAL", "CDELT"):
        if f"{key}{spectral_axis}" not in header:
            raise ViewerError(
                f"Missing {key}{spectral_axis}; the spectral WCS could not be read."
            )

    reference_pixel = float(header.get(f"CRPIX{spectral_axis}", 1.0))
    reference_value = float(header[f"CRVAL{spectral_axis}"])
    step = float(header[f"CDELT{spectral_axis}"])
    pixels = np.arange(length, dtype=float)
    raw_wavelength = reference_value + (pixels - (reference_pixel - 1.0)) * step
    return _to_angstrom(raw_wavelength, header, spectral_axis)


def _json_safe(value: Any) -> Any:
    if isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, (float, np.floating)):
        return float(value) if np.isfinite(value) else None
    if isinstance(value, np.integer):
        return int(value)
    if value is None:
        return None
    return str(value)


def _header_cards(header: fits.Header) -> list[dict[str, Any]]:
    cards = []
    for card in header.cards:
        if card.keyword in {"COMMENT", "HISTORY"}:
            continue
        cards.append(
            {
                "keyword": str(card.keyword),
                "value": _json_safe(card.value),
                "comment": str(card.comment or ""),
            }
        )
    return cards


def _nested_json_image(image: np.ndarray) -> list[list[float | None]]:
    return [
        [float(value) if np.isfinite(value) else None for value in row]
        for row in image
    ]


@dataclass
class DisplayImage:
    values: np.ndarray
    statistic: str
    lambda_min: float | None = None
    lambda_max: float | None = None
    band_index: int | None = None
    band_label: str | None = None


class CubeData:
    """One open FITS HDU with a spectral-first internal data view."""

    def __init__(
        self,
        path: Path,
        hdu_index: int,
        project_root: Path,
        cleanup_on_close: bool = False,
    ):
        self.path = path
        self.hdu_index = hdu_index
        self.project_root = project_root
        self.cube_id = uuid4().hex
        self.cleanup_on_close = cleanup_on_close
        self._hdul: fits.HDUList | None = None
        self._lock = RLock()

        try:
            self._hdul = fits.open(
                path,
                memmap=True,
                do_not_scale_image_data=False,
                lazy_load_hdus=False,
            )
            hdu = self._hdul[hdu_index]
        except (OSError, IndexError, ValueError) as exc:
            self.close()
            raise ViewerError(f"Could not open FITS HDU {hdu_index}: {exc}") from exc

        if hdu.data is None:
            self.close()
            raise ViewerError(f"HDU {hdu_index} does not contain an image or cube.")

        self.header = hdu.header.copy()
        self.hdu_name = str(hdu.name)
        self.original_shape = tuple(int(value) for value in hdu.data.shape)
        layout = _infer_layout(self.header, self.original_shape)
        self.data_kind = layout.kind
        self.supports_spectrum = layout.kind in {"spectral_cube", "long_slit"}
        self.spectral_axis_fits = layout.spectral_axis_fits
        self.layout_note = layout.note
        self.wavelength: np.ndarray | None = None
        self.wavelength_unit: str | None = None
        self._cube: np.ndarray | None = None
        self._image: np.ndarray | None = None
        self._band_cube: np.ndarray | None = None
        self.bands: list[dict[str, Any]] = []
        self.warnings: list[str] = []

        if self.supports_spectrum:
            spectral_axis_numpy = layout.spectral_axis_numpy
            if hdu.data.ndim == 3:
                self._cube = np.moveaxis(hdu.data, spectral_axis_numpy, 0)
            elif spectral_axis_numpy == 0:
                self._cube = hdu.data[:, np.newaxis, :]
            else:
                self._cube = hdu.data.T[:, np.newaxis, :]

            self.wavelength, self.wavelength_unit, unit_warning = (
                _spectral_wavelength(
                    self.header,
                    self.spectral_axis_fits,
                    self._cube.shape[0],
                    len(self.original_shape),
                )
            )
            if unit_warning:
                self.warnings.append(unit_warning)
        elif self.data_kind == "image":
            self._image = hdu.data
            self.bands = [{"index": 0, "label": "Single image"}]
        else:
            self._band_cube = np.moveaxis(
                hdu.data,
                layout.band_axis_numpy,
                0,
            )
            self.bands = [
                {"index": index, "label": f"Band {index + 1}"}
                for index in range(self._band_cube.shape[0])
            ]
            self.warnings.append(layout.note)

        self.spatial_crop = {
            "x_start": 0,
            "x_stop": self.spatial_shape[1],
            "y_start": 0,
            "y_stop": self.spatial_shape[0],
            "original_width": self.spatial_shape[1],
            "original_height": self.spatial_shape[0],
        }

    @property
    def spatial_shape(self) -> tuple[int, int]:
        if self.supports_spectrum:
            return self._cube.shape[1], self._cube.shape[2]
        if self.data_kind == "image":
            return self._image.shape
        return self._band_cube.shape[1], self._band_cube.shape[2]

    def close(self) -> None:
        if self._hdul is not None:
            self._hdul.close()
            self._hdul = None
        if self.cleanup_on_close:
            parent_directory = self.path.parent
            self.path.unlink(missing_ok=True)
            try:
                parent_directory.rmdir()
            except OSError:
                # The upload directory can remain if another process is using it.
                pass
            self.cleanup_on_close = False

    def default_wavelength_bounds(self) -> tuple[float, float]:
        if not self.supports_spectrum or self.wavelength is None:
            raise ViewerError("This FITS HDU does not contain a spectral axis.")
        finite_wavelength = self.wavelength[np.isfinite(self.wavelength)]
        if finite_wavelength.size == 0:
            raise ViewerError("The spectral axis contains no finite wavelengths.")
        if finite_wavelength.size == 1:
            value = float(finite_wavelength[0])
            return value, value
        percentile_5, percentile_95 = np.percentile(finite_wavelength, [5.0, 95.0])
        return float(percentile_5), float(percentile_95)

    def default_image(self, statistic: str = "median") -> DisplayImage:
        if self.supports_spectrum:
            lambda_min, lambda_max = self.default_wavelength_bounds()
            image = self.collapse(lambda_min, lambda_max, statistic=statistic)
            valid_spatial_pixels = np.isfinite(image.values)
        else:
            image = self.band_image(0)
            if self.data_kind == "band_stack":
                valid_spatial_pixels = np.zeros(self.spatial_shape, dtype=bool)
                for band_index in range(self._band_cube.shape[0]):
                    valid_spatial_pixels |= np.isfinite(
                        np.asarray(self._band_cube[band_index])
                    )
            else:
                valid_spatial_pixels = np.isfinite(image.values)

        image.values = self._crop_spatial_border(
            valid_spatial_pixels,
            image.values,
        )
        return image

    def _crop_spatial_border(
        self,
        valid_spatial_pixels: np.ndarray,
        image_values: np.ndarray,
    ) -> np.ndarray:
        """Crop only rows and columns that contain no valid spatial pixels."""

        valid_rows = np.flatnonzero(valid_spatial_pixels.any(axis=1))
        valid_columns = np.flatnonzero(valid_spatial_pixels.any(axis=0))
        if valid_rows.size == 0 or valid_columns.size == 0:
            return np.asarray(image_values, dtype=np.float32)

        y_start = int(valid_rows[0])
        y_stop = int(valid_rows[-1] + 1)
        x_start = int(valid_columns[0])
        x_stop = int(valid_columns[-1] + 1)
        original_height, original_width = self.spatial_shape
        if (
            x_start == 0
            and y_start == 0
            and x_stop == original_width
            and y_stop == original_height
        ):
            return np.asarray(image_values, dtype=np.float32)

        if self._cube is not None:
            self._cube = self._cube[:, y_start:y_stop, x_start:x_stop]
        elif self._image is not None:
            self._image = self._image[y_start:y_stop, x_start:x_stop]
        elif self._band_cube is not None:
            self._band_cube = self._band_cube[
                :,
                y_start:y_stop,
                x_start:x_stop,
            ]

        removed_rows = y_start + (original_height - y_stop)
        removed_columns = x_start + (original_width - x_stop)
        self.spatial_crop = {
            "x_start": x_start,
            "x_stop": x_stop,
            "y_start": y_start,
            "y_stop": y_stop,
            "original_width": original_width,
            "original_height": original_height,
        }
        self.warnings.append(
            f"Cropped the all-NaN spatial border: {removed_rows} rows and "
            f"{removed_columns} columns were removed."
        )
        return np.asarray(
            image_values[y_start:y_stop, x_start:x_stop],
            dtype=np.float32,
        )

    def collapse(
        self,
        lambda_min: float,
        lambda_max: float,
        statistic: str = "median",
    ) -> DisplayImage:
        if not self.supports_spectrum or self._cube is None:
            raise ViewerError("Spectral projection is only available for cubes.")
        if not np.isfinite(lambda_min) or not np.isfinite(lambda_max):
            raise ViewerError("Wavelength bounds must be finite.")
        if lambda_min >= lambda_max:
            raise ViewerError("lambda_min must be smaller than lambda_max.")
        if statistic not in {"median", "mean"}:
            raise ViewerError("statistic must be either 'median' or 'mean'.")

        mask = (
            (self.wavelength >= lambda_min)
            & (self.wavelength <= lambda_max)
            & np.isfinite(self.wavelength)
        )
        if not np.any(mask):
            raise ViewerError("The requested range contains no spectral pixels.")

        selected_wavelength = self.wavelength[mask]
        actual_min = float(np.min(selected_wavelength))
        actual_max = float(np.max(selected_wavelength))
        height, width = self.spatial_shape
        selected_planes = int(np.count_nonzero(mask))
        target_block_values = 16_000_000
        rows_per_block = max(
            1,
            min(
                height,
                target_block_values // max(1, selected_planes * width),
            ),
        )
        image = np.empty((height, width), dtype=np.float32)

        with self._lock:
            # This expected warning only means an output pixel has no finite
            # samples. That pixel is retained as NaN and made transparent.
            with warnings.catch_warnings():
                warnings.filterwarnings(
                    "ignore",
                    message="All-NaN slice encountered",
                    category=RuntimeWarning,
                )
                warnings.filterwarnings(
                    "ignore",
                    message="Mean of empty slice",
                    category=RuntimeWarning,
                )
                for row_start in range(0, height, rows_per_block):
                    row_stop = min(height, row_start + rows_per_block)
                    selected_block = self._cube[mask, row_start:row_stop, :]
                    if statistic == "median":
                        image[row_start:row_stop] = np.nanmedian(
                            selected_block,
                            axis=0,
                        )
                    else:
                        image[row_start:row_stop] = np.nanmean(
                            selected_block,
                            axis=0,
                        )

        return DisplayImage(
            values=image,
            lambda_min=actual_min,
            lambda_max=actual_max,
            statistic=statistic,
        )

    def band_image(self, band_index: int) -> DisplayImage:
        if self.supports_spectrum:
            raise ViewerError("Choose a wavelength interval for this spectral cube.")
        if self.data_kind == "image":
            if band_index != 0:
                raise ViewerError("This FITS HDU contains only one 2D image.")
            values = self._image
            label = "Single image"
        else:
            if not 0 <= band_index < len(self.bands):
                raise ViewerError(
                    f"Band index {band_index} is outside the available "
                    f"range 0–{len(self.bands) - 1}."
                )
            values = self._band_cube[band_index]
            label = self.bands[band_index]["label"]

        return DisplayImage(
            values=np.asarray(values, dtype=np.float32),
            statistic="band",
            band_index=band_index,
            band_label=label,
        )

    def spectrum(self, x: int, y: int) -> np.ndarray:
        if not self.supports_spectrum or self._cube is None:
            raise ViewerError(
                "This FITS HDU is a 2D image and does not have a 1D spectrum."
            )
        height, width = self.spatial_shape
        if not 0 <= x < width or not 0 <= y < height:
            raise ViewerError(
                f"Pixel ({x}, {y}) is outside the spatial image "
                f"of width {width} and height {height}."
            )

        with self._lock:
            return np.array(self._cube[:, y, x], dtype=np.float32, copy=True)

    def wavelength_range(self) -> tuple[float, float]:
        if not self.supports_spectrum or self.wavelength is None:
            raise ViewerError("This FITS HDU does not contain a spectral axis.")
        finite_wavelength = self.wavelength[np.isfinite(self.wavelength)]
        if finite_wavelength.size == 0:
            raise ViewerError("The spectral axis contains no finite wavelengths.")
        return float(np.min(finite_wavelength)), float(np.max(finite_wavelength))

    def summary(self) -> dict[str, Any]:
        cards = _header_cards(self.header)
        summary_keys = (
            "OBJECT",
            "INSTRUME",
            "TELESCOP",
            "BUNIT",
            "NAXIS",
            "NAXIS1",
            "NAXIS2",
            "NAXIS3",
            "CTYPE1",
            "CTYPE2",
            "CTYPE3",
            "CUNIT1",
            "CUNIT2",
            "CUNIT3",
        )
        basic_header = {
            key: _json_safe(self.header[key])
            for key in summary_keys
            if key in self.header
        }
        spectral_step = float(self.header.get(f"CDELT{self.spectral_axis_fits}", 0.0))
        wavelength_summary = None
        if self.supports_spectrum:
            wavelength_min, wavelength_max = self.wavelength_range()
            wavelength_summary = {
                "min": wavelength_min,
                "max": wavelength_max,
                "pixel_scale": spectral_step,
                "unit": self.wavelength_unit,
            }

        return {
            "cube_id": self.cube_id,
            "path": str(self.path.relative_to(self.project_root)),
            "filename": self.path.name,
            "hdu_index": self.hdu_index,
            "hdu_name": self.hdu_name,
            "data_kind": self.data_kind,
            "supports_spectrum": self.supports_spectrum,
            "original_shape": list(self.original_shape),
            "display_shape": list(self.spatial_shape),
            "spatial_shape": {
                "height": self.spatial_shape[0],
                "width": self.spatial_shape[1],
            },
            "spectral_axis_fits": self.spectral_axis_fits,
            "layout_note": self.layout_note,
            "wavelength": wavelength_summary,
            "bands": self.bands,
            "spatial_crop": self.spatial_crop,
            "basic_header": basic_header,
            "header_cards": cards,
            "warnings": self.warnings,
        }

    def image_payload(self, image: DisplayImage) -> dict[str, Any]:
        finite_values = image.values[np.isfinite(image.values)]
        return {
            "shape": list(image.values.shape),
            "values": _nested_json_image(image.values),
            "lambda_min": image.lambda_min,
            "lambda_max": image.lambda_max,
            "statistic": image.statistic,
            "data_kind": self.data_kind,
            "supports_spectrum": self.supports_spectrum,
            "band_index": image.band_index,
            "band_label": image.band_label,
            "bands": self.bands,
            "pixel_origin": {
                "x": self.spatial_crop["x_start"],
                "y": self.spatial_crop["y_start"],
            },
            "finite_pixels": int(finite_values.size),
            "total_pixels": int(image.values.size),
        }


class CubeStore:
    """A small in-process cache of open cubes."""

    def __init__(self, max_open: int = 4):
        self.max_open = max_open
        self._cubes: OrderedDict[str, CubeData] = OrderedDict()
        self._lock = RLock()

    def add(self, cube: CubeData) -> CubeData:
        with self._lock:
            while len(self._cubes) >= self.max_open:
                _, old_cube = self._cubes.popitem(last=False)
                old_cube.close()
            self._cubes[cube.cube_id] = cube
        return cube

    def get(self, cube_id: str) -> CubeData:
        with self._lock:
            cube = self._cubes.get(cube_id)
            if cube is None:
                raise ViewerError("The selected cube session no longer exists.", 404)
            self._cubes.move_to_end(cube_id)
            return cube

    def clear(self) -> None:
        with self._lock:
            for cube in self._cubes.values():
                cube.close()
            self._cubes.clear()


def describe_fits_file(
    path: Path,
    project_root: Path,
) -> dict[str, Any]:
    resolved_path = path.resolve()
    if resolved_path.is_relative_to(project_root.resolve()):
        path_label = str(resolved_path.relative_to(project_root.resolve()))
    else:
        path_label = str(resolved_path)
    hdus = []
    try:
        with fits.open(resolved_path, memmap=True) as hdul:
            for index, hdu in enumerate(hdul):
                if hdu.data is None or hdu.data.ndim not in {2, 3}:
                    continue
                hdus.append(
                    {
                        "index": index,
                        "name": str(hdu.name),
                        "shape": [int(value) for value in hdu.data.shape],
                        "ndim": int(hdu.data.ndim),
                    }
                )
    except (OSError, ValueError) as exc:
        return {
            "path": path_label,
            "name": resolved_path.name,
            "hdus": [],
            "error": f"Could not read FITS header: {exc}",
        }

    return {
        "path": path_label,
        "name": resolved_path.name,
        "hdus": hdus,
    }


def resolve_project_path(project_root: Path, supplied_path: str) -> Path:
    candidate = Path(supplied_path)
    if not candidate.is_absolute():
        candidate = project_root / candidate

    unresolved = candidate.resolve(strict=False)
    if not unresolved.is_relative_to(project_root.resolve()):
        raise ViewerError("FITS paths must stay inside the project directory.")

    try:
        resolved = candidate.resolve(strict=True)
    except FileNotFoundError as exc:
        raise ViewerError(f"FITS file not found: {supplied_path}", 404) from exc

    if not resolved.is_file() or not _is_fits_path(resolved):
        raise ViewerError("The selected path is not a supported FITS file.")
    return resolved


def open_cube(
    project_root: Path,
    supplied_path: str,
    hdu_index: int | None,
) -> CubeData:
    path = resolve_project_path(project_root, supplied_path)
    return open_local_cube(
        path=path,
        hdu_index=hdu_index,
        project_root=project_root,
    )


def open_local_cube(
    path: Path,
    hdu_index: int | None,
    project_root: Path,
    cleanup_on_close: bool = False,
) -> CubeData:
    """Open an already-validated local FITS file."""

    if hdu_index is None:
        with fits.open(path, memmap=True) as hdul:
            candidates = [
                index
                for index, hdu in enumerate(hdul)
                if hdu.data is not None and hdu.data.ndim in {2, 3}
            ]
        if not candidates:
            raise ViewerError("No 2D image or 3D cube HDU was found in this FITS file.")
        hdu_index = candidates[0]

    if hdu_index < 0:
        raise ViewerError("The HDU index cannot be negative.")
    return CubeData(
        path=path,
        hdu_index=hdu_index,
        project_root=project_root,
        cleanup_on_close=cleanup_on_close,
    )
