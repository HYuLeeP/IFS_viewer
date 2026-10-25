import tomllib
from pathlib import Path

from ifs_viewer import __main__ as cli


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_only_ifs_viewer_console_script_is_packaged():
    with (PROJECT_ROOT / "pyproject.toml").open("rb") as stream:
        project = tomllib.load(stream)["project"]

    assert project["scripts"] == {
        "ifs-viewer": "ifs_viewer.__main__:main",
    }


def test_wsl_browser_opening_uses_windows_default(monkeypatch):
    calls = []

    monkeypatch.setattr(cli, "_is_wsl", lambda: True)
    monkeypatch.setattr(
        cli.shutil,
        "which",
        lambda executable: (
            "/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"
            if executable == "powershell.exe"
            else None
        ),
    )
    monkeypatch.setattr(
        cli.subprocess,
        "Popen",
        lambda command, **kwargs: calls.append((command, kwargs)),
    )

    assert cli._open_default_browser("http://127.0.0.1:8050") is True
    assert calls[0][0][0] == "powershell.exe"
    assert "Start-Process" in calls[0][0][-1]


def test_macos_browser_opening_uses_open(monkeypatch):
    calls = []

    monkeypatch.setattr(cli, "_is_wsl", lambda: False)
    monkeypatch.setattr(cli.sys, "platform", "darwin")
    monkeypatch.setattr(
        cli.subprocess,
        "Popen",
        lambda command, **kwargs: calls.append(command),
    )

    assert cli._open_default_browser("http://127.0.0.1:8050") is True
    assert calls == [["open", "http://127.0.0.1:8050"]]
