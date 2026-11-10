#!/usr/bin/env bash
# Paradev workspace setup for the Octree app (app.useoctree.com).
# Runs once when a local worktree is created (SUPERSET_ENV=local) and on every boot
# in the cloud, so it must stay idempotent. It never prints secret values and never
# writes them anywhere but the gitignored env file below.
set -euo pipefail
cd "$(dirname "$0")/.."

PREFIX="OCTREE_APP_"                     # repository-scoped prefix in the personal env file
ENV_FILE=".env.local"                 # gitignored; what the app reads
ROOT="${SUPERSET_ROOT_PATH:-}"          # main checkout (local worktrees only)
PERSONAL="${PARADEV_PERSONAL_ENV:-$HOME/Desktop/all_personal.env}"

# 1. Dependencies. npm repos: clone the main checkout's node_modules (APFS copy-on-write,
#    ~20 s, no extra disk). A symlink is not an option: Turbopack refuses a node_modules
#    link that points outside the project. pnpm repos never clone (pnpm's bin shims hard-
#    code the project folder name), they install from the local pnpm store instead.
#    Anywhere `cp -c` is unavailable (Linux, cloud) this falls through to a clean install.
CLONE_DEPS=yes
if [ ! -e node_modules ]; then
  if [ "$CLONE_DEPS" = yes ] && [ -n "$ROOT" ] && [ -d "$ROOT/node_modules" ] && cp -Rc "$ROOT/node_modules" node_modules 2>/dev/null; then
    echo "setup: node_modules cloned from the main checkout"
  else
    rm -rf node_modules
    npm ci
  fi
fi

# 2. Env: start from the main checkout's gitignored file, then overlay the
#    repository-scoped values from the personal env file (PREFIX_KEY -> KEY).
if [ ! -f "$ENV_FILE" ] && [ -n "$ROOT" ] && [ -f "$ROOT/$ENV_FILE" ]; then
  cp "$ROOT/$ENV_FILE" "$ENV_FILE"
fi
if [ -f "$PERSONAL" ]; then
  python3 -I - "$PERSONAL" "$ENV_FILE" "$PREFIX" "NEXT_PUBLIC_SITE_URL=http://localhost:3000" <<'PY'
import re, shlex, sys, os
personal, env_file, prefix, *overrides = sys.argv[1:]
mapped = {}
for line in open(personal):
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    try:
        tok = shlex.split(line)[0]
    except ValueError:
        continue
    if "=" not in tok:
        continue
    k, v = tok.split("=", 1)
    if k.startswith(prefix) and len(k) > len(prefix):
        mapped[k[len(prefix):]] = v
for o in overrides:                      # local-dev values that must win over production ones
    k, v = o.split("=", 1)
    mapped[k] = v
if not mapped:
    print(f"setup: no {prefix}* keys in {personal}; {env_file} left as is")
    sys.exit(0)
def fmt(k, v):
    if "'" not in v:
        return f"{k}='{v}'"             # single quotes: dotenv takes them literally, no $ expansion
    return f'{k}="' + v.replace("\\", "\\\\").replace('"', '\\"').replace("$", "\\$") + '"'
out, seen = [], set()
if os.path.exists(env_file):
    for line in open(env_file):
        m = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=", line)
        if m and m.group(1) in mapped:
            out.append(fmt(m.group(1), mapped[m.group(1)]) + "\n"); seen.add(m.group(1))
        else:
            out.append(line)
    if out and not out[-1].endswith("\n"):
        out[-1] += "\n"
added = [k for k in mapped if k not in seen]
if added:
    out.append(f"# --- from {os.path.basename(personal)} ({prefix}*), written by .paradev/setup.sh\n")
    out += [fmt(k, mapped[k]) + "\n" for k in added]
with open(env_file, "w") as f:
    f.writelines(out)
print(f"setup: {env_file} <- {len(mapped)} keys from {prefix}* ({len(seen)} updated, {len(added)} added)")
PY
else
  echo "setup: $PERSONAL not found; using $ENV_FILE as copied from the main checkout (if any)"
fi
[ -f "$ENV_FILE" ] && chmod 600 "$ENV_FILE"
echo "setup done for the Octree app (app.useoctree.com)"
