from pathlib import Path

import numpy as np
import pytest
from astropy.io import fits

from ifs_viewer.app import create_app
from ifs_viewer.cube import CubeStore


PROJECT_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture()
def app():
    store = CubeStore()
    flask_app = create_app(cube_store=store)
    flask_app.config.update(TESTING=True)
    yield flask_app
    store.clear()


@pytest.fixture()
def client(app):
    return app.test_client()


def open_muse(client):
    muse_path = PROJECT_ROOT / "MUSE_gas_cube.fits"
    if not muse_path.is_file():
        pytest.skip("Local MUSE integration data is not available.")
    response = client.post(
        "/api/open-path",
        json={"path": str(muse_path), "hdu": 0},
    )
    assert response.status_code == 200
    return response.get_json()


def test_health_and_no_builtin_file_discovery(client):
    assert client.get("/api/health").get_json() == {"status": "ok"}
    assert client.get("/api/files").status_code == 404


def test_browser_shell_and_local_plotly_bundle(client):
    page = client.get("/")
    assert page.status_code == 200
    assert b"IFS_viewer" in page.data
    assert b"Header inspector" in page.data
    assert b'id="fileSelect"' not in page.data
    assert b'id="openButton"' not in page.data
    assert b'data-theme-choice="dark"' in page.data
    assert b'data-theme-choice="light"' in page.data

    stylesheet = client.get("/static/styles.css")
    assert stylesheet.status_code == 200
    assert b"--accent: #66ccff" in stylesheet.data

    application = client.get("/static/app.js")
    assert application.status_code == 200
    assert b"class MapView" in application.data
    assert b'text: "flux"' in application.data

    plotly_bundle = client.get("/vendor/plotly.min.js")
    assert plotly_bundle.status_code == 200
    assert plotly_bundle.content_type == "application/javascript; charset=utf-8"
    assert len(plotly_bundle.data) > 1_000_000

    mathjax_script = client.get("/static/vendor/mathjax/tex-svg.js")
    assert mathjax_script.status_code == 200
    assert len(mathjax_script.data) > 100_000


def test_open_returns_metadata_default_image_and_lines(client):
    payload = open_muse(client)

    assert payload["cube"]["spatial_shape"] == {"height": 210, "width": 136}
    assert payload["cube"]["spatial_crop"] == {
        "original_height": 215,
        "original_width": 139,
        "x_start": 1,
        "x_stop": 137,
        "y_start": 2,
        "y_stop": 212,
    }
    assert payload["image"]["shape"] == [210, 136]
    assert payload["image"]["pixel_origin"] == {"x": 1, "y": 2}
    assert payload["image"]["statistic"] == "median"
    assert payload["image"]["finite_pixels"] > 0
    assert any(line["name"] == "Halpha" for line in payload["lines"])
    assert payload["source"]["name"] == "MUSE_gas_cube.fits"
    assert payload["source"]["hdus"][0]["index"] == 0


def test_image_and_spectrum_endpoints(client):
    payload = open_muse(client)
    cube_id = payload["cube"]["cube_id"]

    image_response = client.get(
        f"/api/cubes/{cube_id}/image",
        query_string={
            "lambda_min": 6000.0,
            "lambda_max": 7000.0,
            "statistic": "mean",
        },
    )
    assert image_response.status_code == 200
    image_payload = image_response.get_json()
    assert image_payload["shape"] == [210, 136]
    assert image_payload["statistic"] == "mean"

    spectrum_response = client.get(
        f"/api/cubes/{cube_id}/spectrum",
        query_string={"x": 20, "y": 30},
    )
    assert spectrum_response.status_code == 200
    spectrum = spectrum_response.get_json()
    assert len(spectrum["wavelength"]) == 3681
    assert len(spectrum["flux"]) == 3681
    assert spectrum["wavelength_unit"] == "Angstrom"


def test_open_long_slit_cube(client):
    slit_path = PROJECT_ROOT / "gas_slit_cube.fits"
    if not slit_path.is_file():
        pytest.skip("Local WiFeS integration data is not available.")
    response = client.post(
        "/api/open-path",
        json={"path": str(slit_path), "hdu": 0},
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["image"]["shape"] == [1, 220]
    assert payload["image"]["pixel_origin"] == {"x": 19, "y": 0}
    assert payload["cube"]["data_kind"] == "long_slit"


def test_two_dimensional_image_and_band_stack_endpoints(tmp_path):
    image_path = tmp_path / "plain.fits"
    fits.PrimaryHDU(np.ones((8, 9), dtype=np.float32)).writeto(image_path)
    bands_path = tmp_path / "bands.fits"
    bands = np.arange(4 * 6 * 7, dtype=np.float32).reshape(4, 6, 7)
    fits.PrimaryHDU(data=bands).writeto(bands_path)

    store = CubeStore()
    flask_app = create_app(project_root=tmp_path, cube_store=store)
    flask_app.config.update(TESTING=True)
    client = flask_app.test_client()

    image_response = client.post(
        "/api/open-path",
        json={"path": str(image_path), "hdu": 0},
    )
    assert image_response.status_code == 200
    image_payload = image_response.get_json()
    assert image_payload["cube"]["data_kind"] == "image"
    assert image_payload["image"]["shape"] == [8, 9]
    assert image_payload["cube"]["wavelength"] is None

    band_response = client.post(
        "/api/open-path",
        json={"path": str(bands_path), "hdu": 0},
    )
    assert band_response.status_code == 200
    band_payload = band_response.get_json()
    assert band_payload["cube"]["data_kind"] == "band_stack"
    assert len(band_payload["cube"]["bands"]) == 4

    band_image = client.get(
        f"/api/cubes/{band_payload['cube']['cube_id']}/image",
        query_string={"band": 2},
    )
    assert band_image.status_code == 200
    assert band_image.get_json()["band_index"] == 2
    assert band_image.get_json()["shape"] == [6, 7]
    store.clear()


def test_open_direct_path_outside_project(tmp_path):
    path = tmp_path / "external_image.fits"
    fits.PrimaryHDU(np.ones((4, 5), dtype=np.float32)).writeto(path)

    store = CubeStore()
    flask_app = create_app(cube_store=store)
    flask_app.config.update(TESTING=True)
    client = flask_app.test_client()

    response = client.post("/api/open-path", json={"path": str(path)})
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["cube"]["filename"] == "external_image.fits"
    assert payload["image"]["shape"] == [4, 5]
    store.clear()


def test_open_browser_selected_file_resolves_path_by_metadata(
    monkeypatch,
    tmp_path,
):
    path = tmp_path / "selected_image.fits"
    fits.PrimaryHDU(np.ones((5, 6), dtype=np.float32)).writeto(path)
    file_stat = path.stat()
    monkeypatch.setenv("CUBE_VIEWER_SEARCH_ROOTS", str(tmp_path))

    store = CubeStore()
    flask_app = create_app(cube_store=store)
    flask_app.config.update(TESTING=True)
    client = flask_app.test_client()

    response = client.post(
        "/api/open-selected",
        json={
            "name": path.name,
            "size": file_stat.st_size,
            "last_modified": file_stat.st_mtime * 1000,
        },
    )
    assert response.status_code == 200
    payload = response.get_json()
    assert payload["resolved_path"] == str(path)
    assert payload["image"]["shape"] == [5, 6]
    store.clear()


def test_bad_paths_and_parameters_return_json_errors(client):
    missing_file = client.post(
        "/api/open-path",
        json={"path": "/tmp/does-not-exist.fits", "hdu": 0},
    )
    assert missing_file.status_code == 404
    assert "not found" in missing_file.get_json()["error"]

    payload = open_muse(client)
    cube_id = payload["cube"]["cube_id"]
    reversed_range = client.get(
        f"/api/cubes/{cube_id}/image",
        query_string={"lambda_min": 8000.0, "lambda_max": 7000.0},
    )
    assert reversed_range.status_code == 400
    assert "lambda_min" in reversed_range.get_json()["error"]

    unknown_statistic = client.get(
        f"/api/cubes/{cube_id}/image",
        query_string={
            "lambda_min": 6000.0,
            "lambda_max": 7000.0,
            "statistic": "variance",
        },
    )
    assert unknown_statistic.status_code == 400
    assert "median" in unknown_statistic.get_json()["error"]

    missing_pixel = client.get(f"/api/cubes/{cube_id}/spectrum")
    assert missing_pixel.status_code == 400


def test_all_nan_pixels_remain_null_in_json(tmp_path):
    path = tmp_path / "nan_cube.fits"
    data = np.ones((4, 2, 3), dtype=np.float32)
    data[:, 0, 0] = np.nan
    header = fits.Header()
    header["CTYPE3"] = "WAVE"
    header["CRVAL3"] = 6000.0
    header["CDELT3"] = 10.0
    fits.PrimaryHDU(data=data, header=header).writeto(path)

    store = CubeStore()
    flask_app = create_app(project_root=tmp_path, cube_store=store)
    flask_app.config.update(TESTING=True)
    client = flask_app.test_client()

    response = client.post(
        "/api/open-path",
        json={"path": str(path), "hdu": 0},
    )
    assert response.status_code == 200
    image = response.get_json()["image"]
    assert image["values"][0][0] is None
    assert image["finite_pixels"] == 5
    store.clear()
