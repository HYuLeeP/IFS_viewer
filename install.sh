#!/usr/bin/env bash

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_HOME="${XDG_DATA_HOME:-$HOME/.local/share}/ifs-viewer"
VENV_DIR="$APP_HOME/venv"
BIN_DIR="${XDG_BIN_HOME:-$HOME/.local/bin}"
LAUNCHER="$BIN_DIR/ifs-viewer"
LAUNCHER_ALIAS="$BIN_DIR/ifs_viewer"
CREATED_SHELL_FILES="$APP_HOME/created-shell-files"
PATH_START="# >>> IFS_viewer PATH >>>"
PATH_END="# <<< IFS_viewer PATH <<<"
PYTHON_BIN="${PYTHON_BIN:-python3}"
MODE="install"

shell_path_files() {
    if [ -f "$HOME/.bashrc" ] || [ "$(basename "${SHELL:-}")" = "bash" ]; then
        printf '%s\n' "$HOME/.bashrc"
    fi
    if [ -n "${ZSH_VERSION:-}" ] || [ -f "${ZDOTDIR:-$HOME}/.zshrc" ] \
        || [ "$(basename "${SHELL:-}")" = "zsh" ] \
        || command -v zsh >/dev/null 2>&1; then
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
        if [ ! -e "$rc_file" ]; then
            touch "$rc_file"
            grep -qxF "$rc_file" "$CREATED_SHELL_FILES" \
                || printf '%s\n' "$rc_file" >> "$CREATED_SHELL_FILES"
        fi
        grep -qF "$PATH_START" "$rc_file" && continue
        grep -qF '.local/bin' "$rc_file" && continue
        printf '\n%s\nexport PATH="$HOME/.local/bin:$PATH"\n%s\n' \
            "$PATH_START" "$PATH_END" >> "$rc_file"
    done < <(shell_path_files)
}

remove_created_shell_files() {
    local rc_file
    [ -f "$CREATED_SHELL_FILES" ] || return 0
    while IFS= read -r rc_file; do
        [ -f "$rc_file" ] || continue
        if ! grep -q '[^[:space:]]' "$rc_file"; then
            rm -f "$rc_file"
        fi
    done < "$CREATED_SHELL_FILES"
}

case "${1:-}" in
    --uninstall|uninstall)
        MODE="uninstall"
        ;;
    --update|update)
        MODE="update"
        ;;
    --help|-h)
        echo "Usage: ./install.sh [install|update|uninstall]"
        echo "       ./install.sh [--update|--uninstall]"
        exit 0
        ;;
    "")
        ;;
    *)
        echo "Unknown option: $1" >&2
        echo "Usage: ./install.sh [install|update|uninstall]" >&2
        exit 2
        ;;
esac

if [ "$#" -gt 1 ]; then
    echo "Only one operation may be specified." >&2
    exit 2
fi

if [ "$MODE" = "uninstall" ]; then
    for launcher in "$LAUNCHER" "$LAUNCHER_ALIAS"; do
        if [ -L "$launcher" ]; then
            rm -f "$launcher"
        elif [ -e "$launcher" ]; then
            echo "Refusing to remove unmanaged file: $launcher" >&2
            exit 1
        fi
    done
    remove_path_blocks
    remove_created_shell_files
    if [ -n "$APP_HOME" ] && [ "${APP_HOME##*/}" = "ifs-viewer" ]; then
        rm -rf -- "$APP_HOME"
    else
        echo "Refusing to remove unexpected app directory: $APP_HOME" >&2
        exit 1
    fi
    echo "IFS_viewer has been uninstalled."
    echo "Open a new terminal to refresh PATH settings."
    exit 0
fi

if [ "$MODE" = "update" ] && [ -d "$PROJECT_ROOT/.git" ] \
    && [ "${IFS_VIEWER_SKIP_GIT_PULL:-0}" != "1" ]; then
    echo "Pulling the latest IFS_viewer changes..."
    git -C "$PROJECT_ROOT" pull --ff-only
fi

"$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' || {
    echo "IFS_viewer requires Python 3.11 or newer." >&2
    exit 1
}

mkdir -p "$APP_HOME" "$BIN_DIR"
touch "$CREATED_SHELL_FILES"
"$PYTHON_BIN" -m venv "$VENV_DIR"
"$VENV_DIR/bin/python" -m pip install --upgrade "$PROJECT_ROOT"

if [ -e "$LAUNCHER" ] && [ ! -L "$LAUNCHER" ]; then
    echo "Refusing to overwrite unmanaged file: $LAUNCHER" >&2
    exit 1
fi
ln -sfn "$VENV_DIR/bin/ifs-viewer" "$LAUNCHER"
if [ -L "$LAUNCHER_ALIAS" ]; then
    rm -f "$LAUNCHER_ALIAS"
elif [ -e "$LAUNCHER_ALIAS" ]; then
    echo "Refusing to overwrite unmanaged file: $LAUNCHER_ALIAS" >&2
    exit 1
fi
add_path_blocks

echo
if [ "$MODE" = "update" ]; then
    echo "IFS_viewer updated."
else
    echo "IFS_viewer installed."
fi
echo "Run: ifs-viewer"
if [[ ":$PATH:" != *":$BIN_DIR:"* ]]; then
    echo "This terminal needs one of:"
    echo "  export PATH=\"$BIN_DIR:\$PATH\""
    echo "  or open a new shell."
fi
