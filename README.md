# IFS_viewer

`IFS_viewer` is a single-user local browser viewer for FITS integral-field
cubes, long-slit spectra, 2D images, and multi-band image stacks.

## Requirements

- Python 3.11 or newer
- A Bash-compatible installer shell
- Network access to PyPI during installation

### Ubuntu and WSL

```bash
sudo apt update
sudo apt install python3 python3-venv python3-pip
```

### macOS

Install Apple's command-line tools and a current Python from Homebrew:

```bash
xcode-select --install
brew install python@3.12
```

The installer runs under Bash but updates `~/.zshrc` when Zsh is available.
macOS users can continue using their normal Zsh terminal.

## Installation

Clone the repository and run the installer:

```bash
git clone git@github.com:HYuLeeP/IFS_viewer.git
cd IFS_viewer
./install.sh
```

The installer:

- creates a private environment at `~/.local/share/ifs-viewer/venv`;
- installs all runtime dependencies;
- installs the `ifs-viewer` command in `~/.local/bin`;
- also installs `ifs_viewer` as a command alias;
- adds `~/.local/bin` to an existing Bash or Zsh startup file when needed.

Open a new terminal, or reload the startup file printed by the installer:

```bash
source ~/.zshrc       # macOS Zsh
source ~/.bashrc      # Ubuntu/WSL Bash
```

## Run

```bash
ifs-viewer
```

Open <http://127.0.0.1:8050>.

To select another data root or port:

```bash
ifs-viewer --data-root /path/to/FITS/data --port 8060
```

Stop the server with `Ctrl+C`. If port 8050 is already occupied, choose another
port with `--port`.

To remove the managed installation:

```bash
./install.sh --uninstall
```

## Opening Files

The application starts with empty panels and ships no FITS data.

- **Select in Explorer…** on Ubuntu/WSL, or **Select in Finder…** on macOS,
  reads only the file's name, byte size, and modification time. The backend
  locates that file and memory-maps the original without uploading its data.
- **Paste path…** accepts a direct path. On Windows use **Shift + right-click →
  Copy as path**; on macOS use **Option + Command + C** in Finder.
- The HDU selector remains available after opening a multi-HDU file.
- The band selector appears automatically for multi-band image stacks.

## Controls

- Scroll over the spatial image to zoom; drag to pan; double-click to reset.
- Drag the image-corner handle to rotate the displayed field.
- Click a spatial pixel to extract its spectrum.
- Switch between NaN-aware median and mean spatial projections.
- Use **Tighter**/**Wider** or scroll over the colorbar to change its editable
  interval. **Auto** restores the 1st–99th percentile range; **Data** uses the
  finite data minimum and maximum.
- The spectrum y-axis is labeled `flux`; the physical unit from `BUNIT` is
  shown in the header panel.
- Scroll over the spectrum to zoom wavelengths.
- Drag horizontally across the spectrum to set the image integration interval.
- Enter a redshift and enable **Rest frame** for pPXF optical-line labels.
- Click the spectrum and choose a line to infer redshift from the exact click.
- Drag the central divider to resize the panels.
- Switch between dark and light themes; the preference is stored in the browser.

Entirely NaN outer rows and columns are cropped from the initial spatial view.
Original pixel coordinates remain visible through stored crop offsets.

## Development

```bash
python3 -m venv .venv
.venv/bin/pip install -e ".[test]"
.venv/bin/python -m pytest
.venv/bin/python -m ifs_viewer
```

The frontend uses Plotly from the installed Python package and a locally
vendored MathJax asset. Node.js/npm is not required.

## License

MIT. See [LICENSE](LICENSE).
