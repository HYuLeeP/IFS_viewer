"""Common optical emission lines supplied by pPXF."""

from __future__ import annotations

import contextlib
import io
import os
import re
import tempfile
from functools import lru_cache
from pathlib import Path

import numpy as np


# pPXF imports Matplotlib while creating line templates. Keep its cache out of
# the user's home directory, which may be read-only in this environment.
_matplotlib_cache = Path(tempfile.gettempdir()) / "ifs_viewer_matplotlib"
_matplotlib_cache.mkdir(exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_matplotlib_cache))

_BALMER_LABELS = {
    "H10": (r"H_{10}", "H₁₀"),
    "H9": (r"H_{9}", "H₉"),
    "H8": (r"H_{8}", "H₈"),
    "Heps": (r"H_{\epsilon}", "Hε"),
    "Hdelta": (r"H_{\delta}", "Hδ"),
    "Hgamma": (r"H_{\gamma}", "Hγ"),
    "Hbeta": (r"H_{\beta}", "Hβ"),
    "Halpha": (r"H_{\alpha}", "Hα"),
}

_ABSORPTION_LABELS = {
    "CaII_K": (r"\mathrm{Ca\,II}\ K", "Ca II K"),
    "CaII_H": (r"\mathrm{Ca\,II}\ H", "Ca II H"),
    "MgI_b1": (r"\mathrm{Mg\,I}\ b_1", "Mg I b₁"),
    "MgI_b2": (r"\mathrm{Mg\,I}\ b_2", "Mg I b₂"),
    "MgI_b3": (r"\mathrm{Mg\,I}\ b_3", "Mg I b₃"),
    "NaI_D2": (r"\mathrm{Na\,I}\ D_2", "Na I D₂"),
    "NaI_D1": (r"\mathrm{Na\,I}\ D_1", "Na I D₁"),
    "CaII_8498": (r"\mathrm{Ca\,II}\ 8498", "Ca II 8498"),
    "CaII_8542": (r"\mathrm{Ca\,II}\ 8542", "Ca II 8542"),
    "CaII_8662": (r"\mathrm{Ca\,II}\ 8662", "Ca II 8662"),
}

_ABSORPTION_LINES = (
    ("CaII_K", 3933.663),
    ("CaII_H", 3968.469),
    ("MgI_b1", 5167.322),
    ("MgI_b2", 5172.684),
    ("MgI_b3", 5183.604),
    ("NaI_D2", 5889.951),
    ("NaI_D1", 5895.924),
    ("CaII_8498", 8498.018),
    ("CaII_8542", 8542.089),
    ("CaII_8662", 8662.140),
)


def _line_display_metadata(ppxf_name: str) -> tuple[str, str]:
    if ppxf_name in _BALMER_LABELS:
        return _BALMER_LABELS[ppxf_name]
    if ppxf_name in _ABSORPTION_LABELS:
        return _ABSORPTION_LABELS[ppxf_name]

    bracket_match = re.fullmatch(
        r"\[([A-Za-z]+)\](\d+)(?:_d)?",
        ppxf_name,
    )
    if bracket_match:
        species, wavelength = bracket_match.groups()
        element = species[0]
        ion = species[1:]
        latex = rf"[\mathrm{{{element}\ {ion}}}]\,{wavelength}"
        display = f"[{element} {ion}] {wavelength}"
        return latex, display

    helium_match = re.fullmatch(r"He(I+)(\d+)", ppxf_name)
    if helium_match:
        roman, wavelength = helium_match.groups()
        latex = rf"\mathrm{{He\ {roman}}}\,{wavelength}"
        display = f"He {roman} {wavelength}"
        return latex, display

    return ppxf_name.replace("_", r"\_"), ppxf_name


@lru_cache(maxsize=1)
def line_catalog() -> tuple[dict[str, object], ...]:
    """Return the pPXF common-line sample at air wavelengths in Angstrom."""

    from ppxf import ppxf_util

    wavelength_grid = np.log(np.linspace(2500.0, 20000.0, 4000))

    # emission_lines prints its selection. The same information is returned as
    # structured data below, so suppress only that internal informational print.
    with contextlib.redirect_stdout(io.StringIO()):
        _, names, wavelengths = ppxf_util.emission_lines(
            wavelength_grid,
            [3000.0, 15000.0],
            1.0,
            tie_balmer=False,
            limit_doublets=False,
            vacuum=False,
        )

    catalog = []
    for name, wavelength in zip(names, wavelengths, strict=True):
        name = str(name)
        latex, display_name = _line_display_metadata(name)
        catalog.append(
            {
                "name": name,
                "latex": latex,
                "display_name": display_name,
                "rest_wavelength": float(wavelength),
                "wavelength_unit": "Angstrom",
                "wavelength_convention": "air",
                "kind": "emission",
                "source": "pPXF emission-line templates",
            }
        )
    catalog.sort(key=lambda line: line["rest_wavelength"])
    absorption_catalog = [
        {
            "name": name,
            "latex": _ABSORPTION_LABELS[name][0],
            "display_name": _ABSORPTION_LABELS[name][1],
            "rest_wavelength": wavelength,
            "wavelength_unit": "Angstrom",
            "wavelength_convention": "air",
            "kind": "absorption",
            "source": "NIST ASD v5.12",
        }
        for name, wavelength in _ABSORPTION_LINES
    ]
    return tuple(catalog + absorption_catalog)


def redshift_from_line(
    observed_wavelength: float,
    rest_wavelength: float,
) -> float:
    """Calculate redshift from exact observed and rest wavelengths."""

    if not np.isfinite(observed_wavelength) or not np.isfinite(rest_wavelength):
        raise ValueError("Observed and rest wavelengths must be finite.")
    if rest_wavelength <= 0 or observed_wavelength <= 0:
        raise ValueError("Observed and rest wavelengths must be positive.")

    redshift = observed_wavelength / rest_wavelength - 1.0
    if not np.isfinite(redshift) or redshift <= -1.0:
        raise ValueError("The selected wavelengths do not produce a valid redshift.")
    return redshift
