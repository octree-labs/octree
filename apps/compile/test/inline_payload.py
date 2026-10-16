#!/usr/bin/env python3
"""
Encode a LaTeX project directory into an inline JSON payload suitable for the
compile endpoint. The payload is written to stdout so it can be piped directly
into curl (e.g. python inline_payload.py project | curl --data-binary @- ...).
"""

import base64
import json
import os
import sys
from pathlib import Path

BINARY_EXTENSIONS = {
    ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif",
    ".eps", ".ps", ".pbm", ".pgm", ".ppm", ".pnm",
    ".ico", ".svg", ".svgz",
    ".zip", ".tar", ".gz", ".bz2",
    ".ttf", ".otf", ".otc", ".woff", ".woff2",
}


def is_binary_file(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in BINARY_EXTENSIONS


def encode_file(filepath: Path, project_root: Path) -> dict:
    relative_path = filepath.relative_to(project_root).as_posix()
    try:
        if is_binary_file(filepath.name):
            with open(filepath, "rb") as f:
                content = base64.b64encode(f.read()).decode("ascii")
            return {"path": relative_path, "content": content, "encoding": "base64"}
        else:
            with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            return {"path": relative_path, "content": content}
    except Exception as exc:
        raise RuntimeError(f"Failed to read {relative_path}: {exc}") from exc


def encode_project(project_dir: Path) -> dict:
    if not project_dir.exists() or not project_dir.is_dir():
        raise SystemExit(f"❌ Directory '{project_dir}' not found")

    files = []
    for root, dirs, filenames in os.walk(project_dir):
        dirs[:] = [
            d for d in dirs
            if not d.startswith(".")
            and d not in {"__pycache__", "node_modules", "build", "dist"}
        ]
        for filename in filenames:
            if filename.startswith("."):
                continue
            filepath = Path(root) / filename
            files.append(encode_file(filepath, project_dir))

    if not files:
        raise SystemExit(f"❌ No files found in '{project_dir}'")

    return {"files": files}


def main():
    if len(sys.argv) != 2:
        print("Usage: python3 inline_payload.py <project_dir>", file=sys.stderr)
        sys.exit(1)

    project_dir = Path(sys.argv[1]).resolve()
    payload = encode_project(project_dir)
    json.dump(payload, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()

