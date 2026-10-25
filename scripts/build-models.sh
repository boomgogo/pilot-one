#!/usr/bin/env bash
# Rebuild the ship GLBs from the Blender script, then compress them for the web.
#   BLENDER=/path/to/blender npm run models
#   PREVIEW_DIR=/tmp/previews npm run models   # also renders preview PNGs of every model
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BLENDER="${BLENDER:-blender}"
BUILD="$ROOT/assets-src/build"
OUT="$ROOT/src/assets"
mkdir -p "$BUILD" "$OUT"

"$BLENDER" -b --factory-startup --python "$ROOT/assets-src/blender/build_ships.py" -- "$BUILD" ${PREVIEW_DIR:+"$PREVIEW_DIR"} \
  | grep -E "tris|exported|Error" || true

for name in ships boss loc2 loc3 loc4 loc5; do
  # weld + meshopt (quantized, EXT_meshopt_compression). Empties (markers) and part_* nodes are kept.
  npx gltf-transform weld "$BUILD/$name.raw.glb" "$BUILD/$name.weld.glb" >/dev/null
  npx gltf-transform meshopt "$BUILD/$name.weld.glb" "$OUT/$name.glb" --level medium >/dev/null
  printf '%-10s raw %7s B  ->  %7s B\n' "$name" "$(wc -c <"$BUILD/$name.raw.glb")" "$(wc -c <"$OUT/$name.glb")"
done
