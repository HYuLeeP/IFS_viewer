from pathlib import Path

import numpy as np
import pytest
from astropy.io import fits

from ifs_viewer.cube import CubeData, ViewerError, open_cube
from ifs_viewer.lines import line_catalog, redshift_from_line


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def muse_cube():
    if not (PROJECT_ROOT / "MUSE_gas_cube.fits").is_file():
        pytest.skip("Local MUSE integration data is not available.")
    cube = open_cube(PROJECT_ROOT, "MUSE_gas_cube.fits", 0)
    yield cube
    cube.close()


@pytest.fixture(scope="module")
def slit_cube():
    if not (PROJECT_ROOT / "gas_slit_cube.fits").is_file():
        pytest.skip("Local WiFeS integration data is not available.")
    cube = open_cube(PROJECT_ROOT, "gas_slit_cube.fits", 0)
    yield cube
    cube.close()


def test_muse_layout_and_default_bounds(muse_cube):
    summary = muse_cube.summary()

    assert summary["display_shape"] == [215, 139]
    assert summary["data_kind"] == "spectral_cube"
    assert summary["supports_spectrum"] is True
    assert summary["spatial_shape"] == {"height": 215, "width": 139}
    assert summary["spectral_axis_fits"] == 3
    assert muse_cube.wavelength_unit == "Angstrom"
    assert summary["wavelength"]["min"] == pytest.approx(4749.697265625)
    assert summary["wavelength"]["max"] == pytest.approx(9349.697265625)

    lambda_min, lambda_max = muse_cube.default_wavelength_bounds()
    assert lambda_min == pytest.approx(4979.697265625)
    assert lambda_max == pytest.approx(9119.697265625)


def test_slit_layout_uses_first_axis_for_spectrum(slit_cube):
    summary = slit_cube.summary()

    assert summary["original_shape"] == [3681, 244]
    assert summary["display_shape"] == [1, 244]
    assert summary["spatial_shape"] == {"height": 1, "width": 244}
    assert summary["data_kind"] == "long_slit"
    assert summary["layout_note"] == "Spectral-first long-slit fallback"


def test_default_median_matches_direct_cube_pixels(muse_cube):
    lambda_min, lambda_max = muse_cube.default_wavelength_bounds()
    collapsed = muse_cube.collapse(lambda_min, lambda_max)

    with fits.open(PROJECT_ROOT / "MUSE_gas_cube.fits", memmap=True) as hdul:
        raw_data = hdul[0].data
        spectral_mask = (
            (muse_cube.wavelength >= lambda_min)
            & (muse_cube.wavelength <= lambda_max)
        )
        for y, x in [(0, 0), (100, 50), (214, 138)]:
            pixel_values = np.asarray(raw_data[spectral_mask, y, x])
            finite_values = pixel_values[np.isfinite(pixel_values)]
            expected = (
                np.median(finite_values) if finite_values.size else np.nan
            )
            if np.isnan(expected):
                assert np.isnan(collapsed.values[y, x])
            else:
                assert collapsed.values[y, x] == pytest.approx(expected)
            np.testing.assert_allclose(
                raw_data[0, y, x],
                np.asarray(muse_cube._cube[0, y, x]),
                equal_nan=True,
            )


def test_extracted_spectra_match_direct_slices(muse_cube, slit_cube):
    y, x = 80, 35
    with fits.open(PROJECT_ROOT / "MUSE_gas_cube.fits", memmap=True) as hdul:
        direct_muse = np.asarray(hdul[0].data[:, y, x])
    np.testing.assert_allclose(muse_cube.spectrum(x, y), direct_muse, equal_nan=True)

    slit_x = 120
    with fits.open(PROJECT_ROOT / "gas_slit_cube.fits", memmap=True) as hdul:
        direct_slit = np.asarray(hdul[0].data[:, slit_x])
    np.testing.assert_allclose(
        slit_cube.spectrum(slit_x, 0),
        direct_slit,
        equal_nan=True,
    )


def test_invalid_pixel_and_wavelength_ranges_fail(muse_cube):
    with pytest.raises(ViewerError, match="outside the spatial image"):
        muse_cube.spectrum(139, 0)

    with pytest.raises(ViewerError, match="lambda_min must be smaller"):
        muse_cube.collapse(8000.0, 7000.0)

    with pytest.raises(ViewerError, match="no spectral pixels"):
        muse_cube.collapse(100.0, 200.0)


def test_mean_projection_matches_direct_cube_pixels(muse_cube):
    lambda_min, lambda_max = muse_cube.default_wavelength_bounds()
    collapsed = muse_cube.collapse(
        lambda_min,
        lambda_max,
        statistic="mean",
    )

    with fits.open(PROJECT_ROOT / "MUSE_gas_cube.fits", memmap=True) as hdul:
        raw_data = hdul[0].data
        spectral_mask = (
            (muse_cube.wavelength >= lambda_min)
            & (muse_cube.wavelength <= lambda_max)
        )
        for y, x in [(0, 0), (100, 50), (214, 138)]:
            pixel_values = np.asarray(raw_data[spectral_mask, y, x])
            finite_values = pixel_values[np.isfinite(pixel_values)]
            expected = (
                np.mean(finite_values) if finite_values.size else np.nan
            )
            if np.isnan(expected):
                assert np.isnan(collapsed.values[y, x])
            else:
                assert collapsed.values[y, x] == pytest.approx(expected)

    assert collapsed.statistic == "mean"


def test_unknown_projection_is_rejected(muse_cube):
    with pytest.raises(ViewerError, match="median.*mean"):
        muse_cube.collapse(6000.0, 7000.0, statistic="variance")


def test_path_outside_project_is_rejected():
    with pytest.raises(ViewerError, match="inside the project"):
        open_cube(PROJECT_ROOT, "/tmp/outside.fits", 0)


def test_two_dimensional_image_opens_without_spectrum(tmp_path):
    image_path = tmp_path / "plain_image.fits"
    fits.PrimaryHDU(np.zeros((5, 7), dtype=np.float32)).writeto(image_path)

    image = CubeData(image_path, 0, tmp_path)
    try:
        assert image.summary()["data_kind"] == "image"
        assert image.summary()["supports_spectrum"] is False
        assert image.spatial_shape == (5, 7)
        payload = image.default_image()
        assert payload.values.shape == (5, 7)
        with pytest.raises(ViewerError, match="2D image"):
            image.spectrum(0, 0)
    finally:
        image.close()


def test_unlabeled_three_dimensional_stack_opens_as_bands(tmp_path):
    cube_path = tmp_path / "band_stack.fits"
    data = np.arange(3 * 4 * 5, dtype=np.float32).reshape(3, 4, 5)
    fits.PrimaryHDU(data=data).writeto(cube_path)

    bands = CubeData(cube_path, 0, tmp_path)
    try:
        summary = bands.summary()
        assert summary["data_kind"] == "band_stack"
        assert summary["supports_spectrum"] is False
        assert summary["spatial_shape"] == {"height": 4, "width": 5}
        assert len(summary["bands"]) == 3
        np.testing.assert_allclose(bands.band_image(2).values, data[2])
    finally:
        bands.close()


def test_default_image_crops_all_nan_spatial_border(tmp_path):
    path = tmp_path / "border_cube.fits"
    data = np.ones((5, 6, 8), dtype=np.float32)
    data[:, [0, 5], :] = np.nan
    data[:, :, [0, 7]] = np.nan
    header = fits.Header()
    header["CTYPE3"] = "WAVE"
    header["CRVAL3"] = 5000.0
    header["CDELT3"] = 1.0
    fits.PrimaryHDU(data=data, header=header).writeto(path)

    cube = CubeData(path, 0, tmp_path)
    try:
        image = cube.default_image()
        payload = cube.image_payload(image)
        assert image.values.shape == (4, 6)
        assert cube.spatial_shape == (4, 6)
        assert cube.spatial_crop["x_start"] == 1
        assert cube.spatial_crop["y_start"] == 1
        assert payload["pixel_origin"] == {"x": 1, "y": 1}
    finally:
        cube.close()


def test_real_muse_combined_layout_is_detected():
    path = PROJECT_ROOT.parent / "MUSE" / "ppxf" / "muse_combined.fits"
    if not path.is_file():
        pytest.skip("External MUSE combined cube is not available.")

    cube = CubeData(path, 1, path.parent)
    try:
        summary = cube.summary()
        assert summary["hdu_name"] == "DATA"
        assert summary["data_kind"] == "spectral_cube"
        assert summary["spatial_shape"] == {"height": 645, "width": 419}
        assert summary["wavelength"]["min"] == pytest.approx(4749.697265625)
    finally:
        cube.close()


def test_ppxf_catalog_has_expected_air_wavelengths():
    catalog = {line["name"]: line["rest_wavelength"] for line in line_catalog()}
    display_catalog = {line["name"]: line for line in line_catalog()}

    assert catalog["Halpha"] == pytest.approx(6562.819, abs=0.001)
    assert catalog["Hbeta"] == pytest.approx(4861.333, abs=0.001)
    assert catalog["[OIII]5007_d"] == pytest.approx(5006.843, abs=0.001)
    assert catalog["[NII]6583_d"] == pytest.approx(6583.452, abs=0.001)
    assert display_catalog["Halpha"]["latex"] == r"H_{\alpha}"
    assert display_catalog["Halpha"]["display_name"] == "Hα"
    assert display_catalog["[OIII]5007_d"]["display_name"] == "[O III] 5007"
    assert display_catalog["NaI_D2"]["kind"] == "absorption"
    assert display_catalog["NaI_D2"]["rest_wavelength"] == pytest.approx(5889.951)
    assert display_catalog["CaII_K"]["rest_wavelength"] == pytest.approx(3933.663)
    assert display_catalog["CaII_8662"]["source"] == "NIST ASD v5.12"
    assert display_catalog["Halpha"]["source"] == "pPXF emission-line templates"


def test_redshift_from_exact_wavelength():
    redshift = redshift_from_line(6600.0, 6562.819)

    assert redshift == pytest.approx(6600.0 / 6562.819 - 1.0)
    with pytest.raises(ValueError, match="positive"):
        redshift_from_line(0.0, 6562.819)
