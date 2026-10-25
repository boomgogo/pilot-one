// Frees the GPU memory of a location's objects when the next location replaces it (Game.unloadLocation).
// Shared materials and geometries (ship and rock materials, the player's models) are passed in `keep`.

export function disposeTree(root, keep = new Set()) {
  root.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (keep.has(m)) continue;
      for (const v of Object.values(m.uniforms || {})) if (v?.value?.isTexture) v.value.dispose();
      m.dispose();
    }
  });
}
