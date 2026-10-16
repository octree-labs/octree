#!/usr/bin/env python3
"""
Helper script to encode a LaTeX project directory into JSON format
for multi-file compilation with binary file support.

Usage:
    python3 encode_project.py <project_dir> [output.json]
    
Example:
    python3 encode_project.py ./my-paper/  project.json
"""

import os
import sys
import json
import base64
from pathlib import Path

# Binary file extensions that should be base64 encoded
BINARY_EXTENSIONS = {
    '.pdf', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tiff', '.tif',
    '.eps', '.ps', '.pbm', '.pgm', '.ppm', '.pnm',
    '.ico', '.svg', '.svgz',
    '.zip', '.tar', '.gz', '.bz2',
}

# Text file extensions
TEXT_EXTENSIONS = {
    '.tex', '.cls', '.sty', '.bst', '.bib', '.def',
    '.cfg', '.ltx', '.dtx', '.ins', '.fd', '.clo',
    '.txt', '.md', '.log', '.aux',
}

def is_binary_file(filename):
    """Determine if a file should be treated as binary based on extension."""
    ext = os.path.splitext(filename)[1].lower()
    
    # Known binary extensions
    if ext in BINARY_EXTENSIONS:
        return True
    
    # Known text extensions
    if ext in TEXT_EXTENSIONS:
        return False
    
    # Default: try to read as text
    return False

def encode_file(filepath, project_root):
    """Encode a file as either text or base64 binary."""
    relative_path = os.path.relpath(filepath, project_root)
    filename = os.path.basename(filepath)
    
    try:
        if is_binary_file(filepath):
            # Binary file: read and encode as base64
            with open(filepath, 'rb') as f:
                content = base64.b64encode(f.read()).decode('ascii')
            return {
                "path": relative_path,
                "content": content,
                "encoding": "base64"
            }
        else:
            # Text file: read as UTF-8
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()
            return {
                "path": relative_path,
                "content": content
            }
    except Exception as e:
        print(f"⚠️  Error reading {relative_path}: {e}", file=sys.stderr)
        return None

def encode_project(project_dir, output_file=None):
    """Encode all files in a project directory."""
    project_path = Path(project_dir).resolve()
    
    if not project_path.exists():
        print(f"❌ Error: Directory '{project_dir}' not found", file=sys.stderr)
        sys.exit(1)
    
    if not project_path.is_dir():
        print(f"❌ Error: '{project_dir}' is not a directory", file=sys.stderr)
        sys.exit(1)
    
    files = []
    text_count = 0
    binary_count = 0
    skipped_count = 0
    
# Find the main .tex file candidate (first root-level .tex)
    main_tex_candidates = set()
    fallback_main_path = None
    for root, dirs, filenames in os.walk(project_path):
        for filename in filenames:
            if filename.endswith('.tex') and root == str(project_path):
                # First .tex file in root directory is a candidate
                main_tex_candidates.add(filename)
                if fallback_main_path is None:
                    fallback_main_path = filename
                break
        break

    has_main_tex = (project_path / "main.tex").is_file()
    
    # Walk through directory
    for root, dirs, filenames in os.walk(project_path):
        # Skip hidden directories and common build directories
        dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['__pycache__', 'node_modules', 'build', 'dist']]
        
        for filename in filenames:
            # Skip hidden files and common generated files
            if filename.startswith('.') or filename in ['texput.log']:
                continue
            
            filepath = os.path.join(root, filename)
            file_entry = encode_file(filepath, project_path)
            
            if file_entry:
                files.append(file_entry)
                if file_entry.get('encoding') == 'base64':
                    binary_count += 1
                    print(f"📦 {file_entry['path']} (binary, {len(file_entry['content'])} bytes base64)")
                else:
                    text_count += 1
                    print(f"📄 {file_entry['path']} (text, {len(file_entry['content'])} chars)")
            else:
                skipped_count += 1
    
    if not files:
        print(f"❌ No files found in '{project_dir}'", file=sys.stderr)
        sys.exit(1)

    # Create JSON payload
    payload = {"files": files}
    
    # Determine output location
    if output_file:
        output_path = output_file
    else:
        output_path = f"{project_path.name}.json"
    
    # Write to file
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2)
    
    # Print summary
    print(f"\n✅ Project encoded successfully!")
    print(f"   📊 Total files: {len(files)} ({text_count} text, {binary_count} binary)")
    if skipped_count > 0:
        print(f"   ⚠️  Skipped: {skipped_count} files")
    print(f"   💾 Output: {output_path} ({os.path.getsize(output_path) / 1024:.1f} KB)")
    print(f"\n📤 Upload to compilation service:")
    print(f"   curl -X POST http://localhost:3001/compile \\")
    print(f"     -H 'Content-Type: application/json' \\")
    print(f"     -d @{output_path} \\")
    print(f"     -o output.pdf")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    
    project_dir = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else None
    
    encode_project(project_dir, output_file)

