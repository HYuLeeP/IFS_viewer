#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/ifs-viewer"
VENV_DIR="$APP_HOME/venv"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
LAUNCHER="$BIN_DIR/ifs-viewer"
LAUNCHER_ALIAS="$BIN_DIR/ifs_viewer"
PATH_START="# >>> IFS_viewer PATH >>>"
PATH_END="# <<< IFS_viewer PATH <<<"
PYTHON_BIN="${PYTHON_BIN:-python3}"

shell_path_files() {
    printf '%s\n' "$HOME/.bashrc"
    if [ -n "${ZSH_VERSION:-}" ] || command -v zsh >/dev/null 2>&1; then
        printf '%s\n' "${ZDOTDIR:-$HOME}/.zshrc"
    fi
}

remove_path_blocks() {
    local rc_file temporary_file
    while IFS= read -r rc_file; do
        [ -f "$rc_file" ] || continue
        grep -qF "$PATH_START" "$rc_file" || continue
        temporary_file="${rc_file}.ifs-viewer.tmp"
        awk -v start="$PATH_START" -v end="$PATH_END" '
            $0 == start { skip = 1; next }
            $0 == end { skip = 0; next }
            !skip { print }
        ' "$rc_file" > "$temporary_file"
        mv "$temporary_file" "$rc_file"
    done < <(shell_path_files)
}

add_path_blocks() {
    local rc_file
    while IFS= read -r rc_file; do
        mkdir -p "$(dirname "$rc_file")"
        touch "$rc_file"
        grep -qF "$PATH_START" "$rc_file" && continue
        grep -qF '.local/bin' "$rc_file" && continue
        printf '\n%s\nexport PATH="$HOME/.local/bin:$PATH"\n%s\n' \
            "$PATH_START" "$PATH_END" >> "$rc_file"
    done < <(shell_path_files)
}

if [ "${1:-}" = "--uninstall" ]; then
    for launcher in "$LAUNCHER" "$LAUNCHER_ALIAS"; do
        if [ -L "$launcher" ]; then
            rm -f "$launcher"
        elif [ -e "$launcher" ]; then
            echo "Refusing to remove unmanaged file: $launcher" >&2
            exit 1
        fi
    done
    rm -rf "$APP_HOME"
    remove_path_blocks
    echo "IFS_viewer has been uninstalled."
    echo "Open a new terminal to refresh PATH settings."
    exit 0
fi

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
    echo "Usage: ./install.sh [--uninstall]"
    exit 0
fi

if [ "$#" -gt 0 ]; then
    echo "Unknown option: $1" >&2
    echo "Usage: ./install.sh [--uninstall]" >&2
    exit 2
fi

"$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' || {
    echo "IFS_viewer requires Python 3.11 or newer." >&2
    exit 1
}

mkdir -p "$APP_HOME" "$BIN_DIR"
"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade "$PROJECT_ROOT"

if [ -e "$LAUNCHER" ] && [ ! -L "$LAUNCHER" ]; then
    echo "Refusing to overwrite unmanaged file: $LAUNCHER" >&2
    exit 1
fi
ln -sfn "$VENV_DIR/bin/ifs-viewer" "$LAUNCHER"
ln -sfn "$VENV_DIR/bin/ifs-viewer" "$LAUNCHER_ALIAS"
add_path_blocks

echo
echo "IFS_viewer installed."
echo "Run: ifs-viewer"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "This terminal needs one of:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    echo "  or open a new shell."
fi
