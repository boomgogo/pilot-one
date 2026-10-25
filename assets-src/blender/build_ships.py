"""
Builds every ship model for Pilot One and exports them as GLB.

    blender -b --factory-startup --python assets-src/blender/build_ships.py -- <out_dir> [preview_dir]

Conventions (game units = metres):
  * nose along Blender +Y (→ three.js -Z), up +Z (→ three.js +Y)
  * flat-shaded low poly, colour from materials (baked into vertex colours in the game),
    emission = glowing parts (engines, cockpits, eyes)
  * child empties named glow_* / gun_* / bay_* are markers read by the game
  * child meshes named part_* are separately destructible boss parts (pivot = object origin)

Outputs: ships.raw.glb (player, drone, dart, wasp, hammer, mine, miner, shade, cruiser, carrier),
boss.raw.glb (mothership), and one GLB per later location (ai/summary.md §10), loaded with it:
  loc2.raw.glb  hauler, driver, refinery, excavator          (The Belt)
  loc3.raw.glb  battleship, flagship                          (Crimson Nebula)
  loc4.raw.glb  groundgun, crawler, fortress                  (Frozen Moon)
  loc5.raw.glb  mirror, plate, gatekeeper, dreadnought        (The Corona)
scripts/build-models.sh compresses them with gltf-transform.
"""
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = argv[0] if argv else os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "build")
PREVIEW_DIR = argv[1] if len(argv) > 1 else None

# --------------------------------------------------------------------------------------------
# materials (linear colours)

PALETTE = {
    # name: (base rgb, emission rgb or None, emission strength)
    "hull_white": ((0.62, 0.66, 0.72), None, 0),
    "hull_grey": ((0.22, 0.25, 0.30), None, 0),
    "dark": ((0.025, 0.028, 0.035), None, 0),
    "accent_blue": ((0.03, 0.16, 0.75), None, 0),
    "accent_orange": ((0.9, 0.25, 0.02), None, 0),
    "canopy": ((0.01, 0.02, 0.04), (0.1, 0.45, 1.0), 0.9),
    "glow_blue": ((0.0, 0.0, 0.0), (0.25, 0.7, 1.0), 2.5),
    "glow_orange": ((0.0, 0.0, 0.0), (1.0, 0.45, 0.08), 2.5),
    "red": ((0.45, 0.03, 0.03), None, 0),
    "red_dark": ((0.10, 0.012, 0.015), None, 0),
    "eye_red": ((0.0, 0.0, 0.0), (1.0, 0.08, 0.03), 3.0),
    "purple": ((0.20, 0.05, 0.36), None, 0),
    "purple_dark": ((0.05, 0.015, 0.08), None, 0),
    "eye_magenta": ((0.0, 0.0, 0.0), (1.0, 0.15, 0.85), 3.0),
    "olive": ((0.14, 0.16, 0.08), None, 0),
    "olive_dark": ((0.05, 0.055, 0.035), None, 0),
    "steel": ((0.16, 0.17, 0.19), None, 0),
    "glow_amber": ((0.0, 0.0, 0.0), (1.0, 0.55, 0.1), 2.5),
    "gunmetal": ((0.07, 0.075, 0.09), None, 0),
    "navy": ((0.06, 0.09, 0.17), None, 0),
    "navy_light": ((0.20, 0.25, 0.36), None, 0),
    "tan": ((0.36, 0.26, 0.14), None, 0),
    "violet": ((0.12, 0.08, 0.20), None, 0),
    "violet_light": ((0.30, 0.24, 0.42), None, 0),
    "glow_violet": ((0.0, 0.0, 0.0), (0.55, 0.25, 1.0), 2.5),
    "core_red": ((0.2, 0.0, 0.02), (1.0, 0.1, 0.25), 2.0),
    "deck": ((0.05, 0.055, 0.065), None, 0),
    # later locations
    "mine_yellow": ((0.62, 0.42, 0.04), None, 0),
    "rust": ((0.30, 0.12, 0.05), None, 0),
    "ore": ((0.42, 0.24, 0.10), None, 0),
    "glow_yellow": ((0.0, 0.0, 0.0), (1.0, 0.8, 0.2), 2.5),
    "teal_dark": ((0.02, 0.07, 0.08), None, 0),
    "teal": ((0.04, 0.22, 0.24), None, 0),
    "glow_teal": ((0.0, 0.0, 0.0), (0.2, 1.0, 0.85), 2.5),
    "crimson": ((0.30, 0.03, 0.06), None, 0),
    "crimson_dark": ((0.08, 0.01, 0.02), None, 0),
    "ice_white": ((0.70, 0.78, 0.85), None, 0),
    "frost": ((0.25, 0.40, 0.55), None, 0),
    "gold": ((0.70, 0.48, 0.10), None, 0),
    "mirror": ((0.85, 0.85, 0.9), (0.9, 0.75, 0.4), 0.6),
    "glow_white": ((0.0, 0.0, 0.0), (1.0, 0.95, 0.85), 3.0),
    "obsidian": ((0.03, 0.025, 0.035), None, 0),
}


def make_materials():
    mats = {}
    for name, (base, emit, strength) in PALETTE.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        bsdf.inputs["Base Color"].default_value = (*base, 1.0)
        bsdf.inputs["Roughness"].default_value = 0.55
        bsdf.inputs["Metallic"].default_value = 0.0
        if emit:
            bsdf.inputs["Emission Color"].default_value = (*emit, 1.0)
            bsdf.inputs["Emission Strength"].default_value = strength
        m.diffuse_color = (*base, 1.0) if not emit else (*emit, 1.0)
        mats[name] = m
    return mats


# --------------------------------------------------------------------------------------------
# geometry builder


def M(loc=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    return Matrix.LocRotScale(Vector(loc), Euler(rot).to_quaternion(), Vector(scale))


class Builder:
    """Accumulates geometry in one bmesh; each piece gets a material slot."""

    def __init__(self, name):
        self.name = name
        self.bm = bmesh.new()
        self.slots = []
        self.smooth_faces = set()

    def _slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def _assign(self, verts, mat, smooth=False):
        idx = self._slot(mat)
        faces = set()
        for v in verts:
            faces.update(v.link_faces)
        for f in faces:
            f.material_index = idx
            f.smooth = smooth
        return faces

    def box(self, size, loc=(0, 0, 0), rot=(0, 0, 0), mat="hull_grey"):
        r = bmesh.ops.create_cube(self.bm, size=1.0, matrix=M(loc, rot, size))
        return self._assign(r["verts"], mat)

    def cyl(self, r1, r2, depth, seg=8, loc=(0, 0, 0), rot=(0, 0, 0), mat="hull_grey", smooth=False):
        r = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=depth, matrix=M(loc, rot))
        return self._assign(r["verts"], mat, smooth)

    def sphere(self, radius, loc=(0, 0, 0), scale=(1, 1, 1), seg=8, rings=6, mat="hull_grey", smooth=True, rot=(0, 0, 0)):
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=radius, matrix=M(loc, rot, scale))
        return self._assign(r["verts"], mat, smooth)

    def ico(self, radius, loc=(0, 0, 0), scale=(1, 1, 1), sub=1, mat="hull_grey", smooth=False, rot=(0, 0, 0)):
        r = bmesh.ops.create_icosphere(self.bm, subdivisions=sub, radius=radius, matrix=M(loc, rot, scale))
        return self._assign(r["verts"], mat, smooth)

    def loft(self, sections, mat="hull_grey", caps=True, smooth=False):
        """Quads between consecutive rings of points (same count), capped with n-gons."""
        bm = self.bm
        rings = [[bm.verts.new(Vector(p)) for p in sec] for sec in sections]
        n = len(sections[0])
        faces = []
        for a, b in zip(rings, rings[1:]):
            for j in range(n):
                k = (j + 1) % n
                faces.append(bm.faces.new((a[j], a[k], b[k], b[j])))
        if caps:
            for r, rev in ((sections[0], True), (sections[-1], False)):
                if len({tuple(round(c, 5) for c in p) for p in r}) < 3:
                    continue  # degenerate ring (a point): no cap needed
                vs = rings[0] if rev else rings[-1]
                faces.append(bm.faces.new(list(reversed(vs)) if rev else vs))
        idx = self._slot(mat)
        for f in faces:
            f.material_index = idx
            f.smooth = smooth
        return faces

    def slab(self, outline, z0, z1, mat="hull_grey"):
        """Extrude a 2D outline (x, y) between heights z0 and z1."""
        return self.loft([[(x, y, z0) for x, y in outline], [(x, y, z1) for x, y in outline]], mat)

    def wing(self, root, tip, mat="hull_grey"):
        """root/tip: (x, y_le, y_te, z, thickness). Diamond airfoil sections lofted from root to tip."""

        def sec(x, yle, yte, z, t):
            ym = yle * 0.45 + yte * 0.55
            return [(x, yle, z), (x, ym, z + t), (x, yte, z), (x, ym, z - t)]

        return self.loft([sec(*root), sec(*tip)], mat)

    def mirror_x(self):
        """Mirror everything built so far across X (build the right side, then mirror)."""
        bm = self.bm
        geom = list(bm.verts) + list(bm.edges) + list(bm.faces)
        ret = bmesh.ops.duplicate(bm, geom=geom)
        verts = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMVert)]
        faces = [e for e in ret["geom"] if isinstance(e, bmesh.types.BMFace)]
        for v in verts:
            v.co.x = -v.co.x
        bmesh.ops.reverse_faces(bm, faces=faces)

    def finish(self, mats, parent=None, loc=(0, 0, 0)):
        bm = self.bm
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for s in self.slots:
            me.materials.append(mats[s])
        ob = bpy.data.objects.new(self.name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = loc
        if parent:
            ob.parent = parent
        return ob


def empty(name, loc, parent):
    e = bpy.data.objects.new(name, None)
    e.empty_display_size = 0.2
    e.location = loc
    e.parent = parent
    bpy.context.scene.collection.objects.link(e)
    return e


def ring(y, rx, rz, n=6, cx=0.0, cz=0.0, phase=0.0):
    return [(cx + rx * math.cos(phase + 2 * math.pi * i / n), y, cz + rz * math.sin(phase + 2 * math.pi * i / n)) for i in range(n)]


# --------------------------------------------------------------------------------------------
# models


def build_player(mats):
    b = Builder("player")
    # right side, mirrored below
    b.wing((0.35, 0.9, -1.1, 0.0, 0.12), (2.3, -0.55, -1.25, -0.05, 0.04), "hull_white")  # main delta wing
    b.box((0.06, 0.9, 0.08), (1.35, -0.75, 0.06), (0, 0, 0.05), "accent_blue")  # wing stripe
    b.wing((2.2, -0.2, -1.3, -0.05, 0.05), (2.35, -0.35, -1.25, -0.05, 0.04), "accent_orange")  # wingtip cap
    b.cyl(0.07, 0.07, 1.0, 6, (2.3, 0.25, -0.05), (math.pi / 2, 0, 0), "dark")  # wingtip cannon
    b.loft([ring(-1.9, 0.3, 0.3, 8, cx=0.55), ring(-0.6, 0.34, 0.34, 8, cx=0.55), ring(0.4, 0.22, 0.22, 8, cx=0.5)], "hull_grey")  # engine pod
    b.cyl(0.26, 0.2, 0.25, 8, (0.55, -2.02, 0), (math.pi / 2, 0, 0), "glow_blue")  # nozzle
    b.slab([(0.55, -1.05), (0.95, -1.75), (0.95, -1.95), (0.55, -1.9)], 0.15, 0.2, "accent_blue")  # fin base
    b.loft([[(0.62, -1.2, 0.2), (0.62, -1.9, 0.2), (0.66, -1.95, 0.25)], [(0.9, -1.75, 1.05), (0.9, -2.05, 1.05), (0.92, -2.08, 1.07)]], "accent_blue")  # tail fin
    b.mirror_x()
    # centre fuselage
    b.loft([
        [(0, 2.6, 0.02)] * 6,
        ring(1.7, 0.22, 0.16, 6, cz=0.02),
        ring(0.6, 0.42, 0.3, 6, cz=0.05),
        ring(-0.7, 0.5, 0.33, 6, cz=0.05),
        ring(-1.8, 0.36, 0.25, 6, cz=0.02),
    ], "hull_white")
    b.box((0.08, 1.8, 0.05), (0, 0.6, 0.33), (0, 0, 0), "accent_blue")  # spine stripe
    b.sphere(0.27, (0, 0.55, 0.3), (1, 2.4, 0.9), 10, 6, "canopy")
    b.cyl(0.22, 0.16, 0.2, 6, (0, -1.9, 0.02), (math.pi / 2, 0, 0), "glow_blue")
    ob = b.finish(mats)
    for i, x in enumerate((0.55, -0.55)):
        empty(f"glow_{i}", (x, -2.2, 0), ob)
    empty("glow_2", (0, -2.05, 0.02), ob)
    for i, x in enumerate((2.3, -2.3)):
        empty(f"gun_{i}", (x, 0.8, -0.05), ob)
    return ob


def build_drone(mats):
    b = Builder("drone")
    b.loft([[(0, 0.8, 0)] * 4, ring(0.1, 0.32, 0.22, 4), ring(-0.6, 0.22, 0.16, 4)], "hull_white")
    b.wing((0.15, 0.1, -0.5, 0, 0.05), (0.75, -0.3, -0.6, 0, 0.03), "accent_orange")
    b.wing((-0.15, 0.1, -0.5, 0, 0.05), (-0.75, -0.3, -0.6, 0, 0.03), "accent_orange")
    b.cyl(0.14, 0.1, 0.12, 6, (0, -0.65, 0), (math.pi / 2, 0, 0), "glow_orange")
    return b.finish(mats)


def build_dart(mats):
    b = Builder("dart")
    # forward-swept blades (right), mirrored
    b.wing((0.3, 0.2, -1.4, 0, 0.14), (2.2, 1.4, 0.6, 0.15, 0.04), "red")
    b.wing((0.3, -0.9, -2.0, 0, 0.08), (1.3, -1.9, -2.3, -0.1, 0.04), "red_dark")  # rear fin
    b.box((0.06, 0.9, 0.06), (1.6, 0.85, 0.2), (0, 0, -0.55), "eye_red")  # blade light
    b.mirror_x()
    b.loft([
        [(0, 2.6, 0)] * 6,
        ring(1.4, 0.32, 0.26, 6),
        ring(0.0, 0.48, 0.4, 6),
        ring(-1.6, 0.34, 0.3, 6),
        ring(-2.3, 0.2, 0.2, 6),
    ], "red_dark")
    b.sphere(0.24, (0, 1.6, 0.14), (1, 1.4, 0.8), 8, 5, "eye_red")
    b.cyl(0.22, 0.14, 0.2, 6, (0, -2.4, 0), (math.pi / 2, 0, 0), "glow_orange")
    b.slab([(-0.05, -0.6), (0.05, -0.6), (0.05, -2.0), (-0.05, -2.0)], 0.3, 1.0, "red")  # dorsal fin
    ob = b.finish(mats)
    empty("glow_0", (0, -2.55, 0), ob)
    return ob


def build_wasp(mats):
    b = Builder("wasp")
    # mandible prongs + wings (right), mirrored
    b.loft([ring(0.6, 0.18, 0.18, 5, cx=0.55), ring(2.2, 0.14, 0.14, 5, cx=0.7), [(0.6, 2.9, 0)] * 5], "purple_dark")
    b.wing((0.4, 0.6, -0.6, 0.35, 0.05), (2.6, -0.2, -1.2, 0.9, 0.03), "purple")
    b.wing((0.4, -0.5, -1.4, 0.2, 0.04), (2.3, -1.4, -2.0, 0.55, 0.02), "purple_dark")
    b.sphere(0.13, (0.36, 1.25, 0.28), (1, 1, 1), 6, 4, "eye_magenta")
    b.mirror_x()
    b.sphere(0.95, (0, 0.6, 0), (0.85, 1.25, 0.7), 10, 7, "purple", smooth=False)  # head/thorax
    b.sphere(0.8, (0, -1.4, -0.05), (0.8, 1.6, 0.7), 10, 7, "purple_dark", smooth=False)  # abdomen
    for i in range(3):
        b.cyl(0.62 - i * 0.12, 0.6 - i * 0.12, 0.12, 10, (0, -0.9 - i * 0.6, -0.05), (math.pi / 2, 0, 0), "eye_magenta")  # stripes
    ob = b.finish(mats)
    empty("glow_0", (0, -2.6, -0.05), ob)
    return ob


def build_hammer(mats):
    b = Builder("hammer")
    # hammerhead (right half) + cannon + sponson, mirrored
    b.slab([(0, 4.6), (6.8, 4.2), (7.6, 3.2), (7.2, 2.2), (0, 2.6)], -0.8, 0.8, "olive")
    b.cyl(0.42, 0.42, 3.2, 8, (5.2, 5.6, 0), (math.pi / 2, 0, 0), "steel")
    b.cyl(0.6, 0.6, 0.6, 8, (5.2, 4.3, 0), (math.pi / 2, 0, 0), "olive_dark")
    b.box((0.8, 0.12, 0.3), (5.2, 7.25, 0), (0, 0, 0), "glow_amber")
    b.slab([(1.4, 1.0), (3.4, -1.0), (3.4, -4.6), (1.4, -5.2)], -0.9, 0.5, "olive_dark")  # side sponson
    b.cyl(0.7, 0.55, 1.0, 8, (2.4, -5.6, -0.2), (math.pi / 2, 0, 0), "steel")  # engine
    b.cyl(0.55, 0.5, 0.2, 8, (2.4, -6.15, -0.2), (math.pi / 2, 0, 0), "glow_orange")
    b.box((0.1, 2.4, 0.3), (7.0, 3.3, 0.85), (0, 0, -0.2), "glow_amber")  # head running light
    b.mirror_x()
    b.loft([ring(3.2, 1.3, 1.0, 8), ring(0.0, 1.8, 1.35, 8), ring(-4.0, 1.7, 1.25, 8), ring(-6.2, 1.1, 0.9, 8)], "olive")  # hull
    b.box((1.6, 2.2, 0.8), (0, -0.4, 1.4), (0, 0, 0), "olive_dark")  # bridge
    b.box((1.2, 0.15, 0.25), (0, 0.72, 1.55), (0, 0, 0), "glow_amber")  # bridge window
    ob = b.finish(mats)
    for i, x in enumerate((2.4, -2.4)):
        empty(f"glow_{i}", (x, -6.4, -0.2), ob)
    for i, x in enumerate((5.2, -5.2)):
        empty(f"gun_{i}", (x, 7.3, 0), ob)
    return ob


def build_mine(mats):
    b = Builder("mine")
    b.ico(1.25, sub=1, mat="gunmetal")
    b.cyl(1.32, 1.32, 0.3, 12, (0, 0, 0), (0, 0, 0), "eye_red")  # equator band
    ico = bmesh.new()
    bmesh.ops.create_icosphere(ico, subdivisions=0, radius=1.0)
    for v in ico.verts:
        d = v.co.normalized()
        rot = d.to_track_quat("Z", "Y").to_euler()
        b.cyl(0.24, 0.0, 1.1, 5, tuple(d * 1.6), tuple(rot), "steel")
        b.sphere(0.12, tuple(d * 2.15), (1, 1, 1), 5, 3, "eye_red")
    ico.free()
    return b.finish(mats)


def build_miner(mats):
    """Mining drone (The Belt): small, many, rams. Yellow with a red eye."""
    b = Builder("miner")
    b.box((0.5, 1.2, 0.3), (0.9, -0.2, 0), (0, 0, -0.3), "steel")  # claw arm
    b.cyl(0.18, 0.0, 0.8, 4, (1.3, 0.75, 0), (-math.pi / 2, 0, 0), "steel")  # claw tip
    b.mirror_x()
    b.loft([[(0, 1.4, 0)] * 6, ring(0.6, 0.55, 0.45, 6), ring(-0.6, 0.7, 0.55, 6), ring(-1.2, 0.4, 0.35, 6)], "mine_yellow")
    b.box((1.2, 0.3, 0.12), (0, 0.1, 0.5), (0, 0, 0), "rust")
    b.sphere(0.2, (0, 1.0, 0.18), (1, 1, 1), 6, 4, "eye_red")
    b.cyl(0.3, 0.22, 0.15, 6, (0, -1.3, 0), (math.pi / 2, 0, 0), "glow_orange")
    ob = b.finish(mats)
    empty("glow_0", (0, -1.4, 0), ob)
    return ob


def build_shade(mats):
    """Cloaked wasp (Crimson Nebula): dark, sleek, glow lines; only fully visible while charging its guns."""
    b = Builder("shade")
    b.wing((0.4, 1.0, -1.0, 0.0, 0.08), (2.8, -0.6, -1.6, 0.25, 0.03), "teal_dark")
    b.box((0.05, 1.8, 0.05), (1.6, -0.3, 0.1), (0, 0, 0.55), "glow_teal")
    b.loft([ring(0.4, 0.14, 0.14, 4, cx=0.5), ring(2.4, 0.08, 0.08, 4, cx=0.55), [(0.55, 3.0, 0)] * 4], "teal")
    b.mirror_x()
    b.loft([[(0, 2.6, 0)] * 6, ring(1.2, 0.4, 0.3, 6), ring(-0.8, 0.55, 0.38, 6), ring(-2.2, 0.25, 0.2, 6)], "teal_dark")
    b.sphere(0.2, (0, 1.4, 0.2), (1, 1.6, 0.7), 6, 4, "glow_teal")
    ob = b.finish(mats)
    empty("glow_0", (0, -2.3, 0), ob)
    return ob


# ---- location 2: The Belt


def build_hauler(mats):
    """Ore hauler (hulk): a long spine with four ore pods (part_pod0..3) and a cab. ~70 long, nose +Y."""
    b = Builder("hauler")
    b.box((2.2, 70, 2.2), (0, 0, 0), (0, 0, 0), "steel")  # spine truss
    for y in range(-30, 31, 10):
        b.box((10, 0.8, 0.8), (0, y, 0), (0, 0, 0), "gunmetal")  # cross members
    b.loft([ring(42, 3.0, 2.6, 8), ring(34, 5.2, 4.2, 8), ring(26, 5.0, 4.0, 8), ring(24, 3.0, 3.0, 8)], "mine_yellow")  # cab
    b.box((6, 0.3, 1.0), (0, 40.5, 1.4), (0, 0, 0), "canopy")
    for x in (-3.5, 3.5):
        b.cyl(2.6, 2.2, 6, 8, (x, -37, 0), (math.pi / 2, 0, 0), "steel")
        b.cyl(2.2, 2.0, 0.4, 8, (x, -40.2, 0), (math.pi / 2, 0, 0), "glow_orange")
    ob = b.finish(mats)
    for i, (x, y) in enumerate([(6.5, 12), (-6.5, 12), (6.5, -12), (-6.5, -12)]):
        p = Builder(f"part_pod{i}")
        p.box((6, 14, 6), (0, 0, 0), (0, 0, 0), "ore")
        p.box((6.2, 1.2, 6.2), (0, 5, 0), (0, 0, 0), "mine_yellow")
        p.box((6.2, 1.2, 6.2), (0, -5, 0), (0, 0, 0), "mine_yellow")
        p.box((0.3, 8, 0.6), (3.1 if x > 0 else -3.1, 0, 2.2), (0, 0, 0), "glow_amber")
        p.finish(mats, ob, (x, y, 0))
    for i, x in enumerate((3.5, -3.5)):
        empty(f"glow_{i}", (x, -41, 0), ob)
    return ob


def build_driver(mats):
    """Mass driver (hulk): a platform on a rock with two coil barrels (part_gunL/R) that lob boulders."""
    b = Builder("driver")
    b.ico(14, (0, -4, -12), (1.2, 1.0, 0.7), 1, "ore")  # the rock it is bolted to
    b.slab([(-14, -10), (14, -10), (16, 4), (8, 12), (-8, 12), (-16, 4)], -1.5, 1.5, "steel")
    b.box((6, 8, 5), (0, -4, 4), (0, 0, 0), "mine_yellow")
    b.box((4, 0.3, 1.2), (0, 0.1, 5.5), (0, 0, 0), "glow_amber")
    ob = b.finish(mats)
    for name, x in (("part_gunL", -7), ("part_gunR", 7)):
        g = Builder(name)
        g.cyl(2.2, 2.2, 3, 8, (0, 0, 0), (0, 0, 0), "gunmetal")
        g.cyl(1.0, 1.0, 22, 8, (0, 9, 1.5 + 9 * 0.36), (-(math.pi / 2 - 0.35), 0, 0), "steel")
        for k in range(4):
            g.cyl(1.5, 1.5, 0.7, 8, (0, 2.5 + k * 4.5, 1.5 + (2.5 + k * 4.5) * 0.36), (-(math.pi / 2 - 0.35), 0, 0), "glow_yellow")
        g.finish(mats, ob, (x, 4, 3))
    return ob


def build_refinery(mats):
    """Refinery segment (hulk): a 120-long truss with two tanks (part_tank0/1) and four turrets (part_turret0..3)
    on its +X side."""
    b = Builder("refinery")
    b.box((8, 120, 8), (0, 0, 0), (0, 0, 0), "steel")
    for y in range(-55, 56, 11):
        b.box((14, 1.2, 14), (0, y, 0), (0, 0, 0), "gunmetal")
        b.box((0.5, 0.5, 0.5), (7.2, y, 7.2), (0, 0, 0), "glow_amber")
    b.box((10, 30, 18), (-8, 30, 6), (0, 0, 0), "rust")
    b.box((10, 0.4, 2), (-8, 45.2, 10), (0, 0, 0), "glow_amber")
    b.cyl(2, 2, 26, 8, (-8, -30, 12), (0, 0, 0), "steel")  # chimney
    b.cyl(2.4, 2.4, 1, 8, (-8, -30, 25.5), (0, 0, 0), "glow_orange")
    ob = b.finish(mats)
    for i, y in enumerate((-14, 14)):
        t = Builder(f"part_tank{i}")
        t.cyl(6, 6, 16, 12, (0, 0, 0), (math.pi / 2, 0, 0), "mine_yellow", smooth=True)
        t.cyl(6.2, 6.2, 1.2, 12, (0, 0, 0), (math.pi / 2, 0, 0), "rust")
        t.finish(mats, ob, (-10, y, -10))
    for i, y in enumerate((-48, -24, 24, 48)):
        turret(mats, f"part_turret{i}", ob, (5.5, y, 4.5), 1.25)
    return ob


def build_excavator(mats):
    """The Excavator (boss, The Belt): a mining ship with a drill (part_drill), rock launchers (part_launcherL/R),
    cutting lasers (part_laserL/R) and a core behind the drill (part_core). Faces +Y."""
    b = Builder("excavator")
    b.slab([(4, 10), (14, 6), (16, -10), (12, -20), (4, -22)], -5, 5, "mine_yellow")
    b.slab([(14, 6), (16, -10), (16.5, -10), (14.5, 6)], -1, 1, "glow_amber")
    b.box((3, 20, 3), (12, -6, -6.5), (0, 0, 0), "rust")
    b.cyl(3, 2.4, 5, 8, (9, -24, 0), (math.pi / 2, 0, 0), "steel")
    b.cyl(2.4, 2.2, 0.4, 8, (9, -26.6, 0), (math.pi / 2, 0, 0), "glow_orange")
    b.mirror_x()
    b.box((10, 30, 12), (0, -6, 0), (0, 0, 0), "rust")
    b.box((8, 6, 6), (0, -10, 8), (0, 0, 0), "mine_yellow")  # bridge
    b.box((7, 0.3, 1.5), (0, -6.9, 9.5), (0, 0, 0), "canopy")
    ob = b.finish(mats)
    d = Builder("part_drill")
    d.cyl(8, 0.6, 16, 10, (0, 8, 0), (-math.pi / 2, 0, 0), "steel")
    for k in range(5):
        d.cyl(8 - k * 1.5, 7.6 - k * 1.5, 1.0, 10, (0, 2 + k * 3, 0), (math.pi / 2, k * 0.3, 0), "gunmetal")
    d.finish(mats, ob, (0, 14, 0))
    for name, x in (("part_launcherL", -15), ("part_launcherR", 15)):
        l = Builder(name)
        l.box((6, 8, 6), (0, 0, 0), (0, 0, 0), "steel")
        l.cyl(2.4, 2.4, 6, 8, (0, 6, 1), (math.pi / 2, 0, 0), "gunmetal")
        l.cyl(1.8, 1.8, 0.4, 8, (0, 9.2, 1), (math.pi / 2, 0, 0), "glow_orange")
        l.finish(mats, ob, (x, 6, 4))
    for name, x in (("part_laserL", -10), ("part_laserR", 10)):
        l = Builder(name)
        l.sphere(2.2, (0, 0, 0), (1, 1, 1), 8, 6, "steel", smooth=False)
        l.cyl(0.6, 0.4, 5, 6, (0, 3.5, 0), (math.pi / 2, 0, 0), "gunmetal")
        l.box((0.8, 0.4, 0.8), (0, 6.2, 0), (0, 0, 0), "eye_red")
        l.finish(mats, ob, (x, 10, -5))
    core = Builder("part_core")
    core.sphere(3.4, (0, 0, 0), (1, 1, 1), 12, 8, "core_red", smooth=True)
    core.cyl(4.0, 4.0, 0.6, 12, (0, 0, 0), (math.pi / 2, 0, 0), "steel")
    core.finish(mats, ob, (0, 6, 7))
    for i, x in enumerate((9, -9)):
        empty(f"glow_{i}", (x, -27, 0), ob)
    return ob


# ---- location 3: Crimson Nebula


def build_battleship(mats):
    """Battleship (hulk, mid-boss): 160 long, eight turrets along its deck (part_turret0..7), a bridge
    (part_bridge). Nose +Y."""
    b = Builder("battleship")
    b.slab([(3, 80), (12, 50), (14, -50), (10, -78), (3, -80)], -6, 3, "navy")
    b.slab([(12, 50), (14, -50), (14.6, -50), (12.6, 50)], -1.5, -0.5, "glow_amber")
    b.cyl(4, 3.4, 8, 8, (8, -82, -2), (math.pi / 2, 0, 0), "steel")
    b.cyl(3.4, 3.2, 0.5, 8, (8, -86.2, -2), (math.pi / 2, 0, 0), "glow_orange")
    b.mirror_x()
    b.box((10, 120, 4), (0, -5, 4), (0, 0, 0), "navy_light")
    for y in range(-60, 61, 12):
        b.box((0.6, 0.6, 0.6), (5.4, y, 6.2), (0, 0, 0), "glow_amber")
    ob = b.finish(mats)
    for i, y in enumerate((60, 44, 28, 12, -4, -20, -36, -52)):
        turret(mats, f"part_turret{i}", ob, (0 if i % 2 else 0, y, 6.5), 1.6)
    br = Builder("part_bridge")
    br.box((8, 10, 12), (0, 0, 0), (0, 0, 0), "navy")
    br.box((7, 0.3, 2), (0, 5.1, 3), (0, 0, 0), "glow_amber")
    br.box((2, 2, 8), (0, -2, 9), (0, 0, 0), "steel")
    br.finish(mats, ob, (0, -68, 12))
    for i, x in enumerate((8, -8)):
        empty(f"glow_{i}", (x, -87, -2), ob)
    return ob


def build_flagship(mats):
    """The Flagship (boss, Crimson Nebula): a broad wedge with four broadside batteries (part_batL1/L2/R1/R2), two
    missile pods (part_podL/R) and the bridge as its core (part_core). Faces +Y."""
    b = Builder("flagship")
    b.slab([(3, 30), (22, 8), (34, -14), (30, -22), (8, -26), (3, -24)], -4, 4, "crimson")
    b.slab([(22, 8), (34, -14), (34.6, -13.4), (22.6, 8.6)], -1, 1, "glow_amber")
    b.cyl(3.5, 3, 6, 8, (12, -28, 0), (math.pi / 2, 0, 0), "steel")
    b.cyl(3, 2.8, 0.4, 8, (12, -31.2, 0), (math.pi / 2, 0, 0), "glow_orange")
    b.mirror_x()
    b.loft([ring(30, 3, 2, 8), ring(14, 9, 6, 8), ring(-10, 10, 7, 8), ring(-24, 6, 5, 8)], "crimson_dark")
    ob = b.finish(mats)

    def battery(name, loc):
        c = Builder(name)
        c.box((7, 9, 4), (0, 0, 0), (0, 0, 0), "crimson_dark")
        for x in (-2, 0, 2):
            c.cyl(0.5, 0.5, 6, 6, (x, 6, 0.5), (math.pi / 2, 0, 0), "steel")
            c.box((0.7, 0.3, 0.7), (x, 9.1, 0.5), (0, 0, 0), "glow_orange")
        return c.finish(mats, ob, loc)

    battery("part_batL1", (-22, 0, 5))
    battery("part_batL2", (-12, 10, 5))
    battery("part_batR1", (22, 0, 5))
    battery("part_batR2", (12, 10, 5))
    for name, x in (("part_podL", -26), ("part_podR", 26)):
        c = Builder(name)
        c.box((6, 6, 6), (0, 0, 0), (0, 0, 0), "steel")
        for k in range(4):
            c.cyl(0.6, 0.6, 0.6, 6, ((k % 2 - 0.5) * 2.4, 3.2, (k // 2 - 0.5) * 2.4), (math.pi / 2, 0, 0), "glow_orange")
        c.finish(mats, ob, (x, -12, -5))
    core = Builder("part_core")
    core.box((10, 8, 8), (0, 0, 0), (0, 0, 0), "crimson")
    core.box((9, 0.3, 2), (0, 4.1, 2), (0, 0, 0), "eye_red")
    core.sphere(3, (0, 0, 5), (1, 1, 0.6), 10, 6, "core_red")
    core.finish(mats, ob, (0, 8, 8))
    for i, x in enumerate((12, -12)):
        empty(f"glow_{i}", (x, -31.5, 0), ob)
    return ob


# ---- location 4: Frozen Moon


def build_groundgun(mats):
    """Flak tower on the ice (hulk): a pad and a tower; the gun (part_gun) and its radar (part_radar)."""
    b = Builder("groundgun")
    b.cyl(9, 11, 3, 8, (0, 0, 0), (0, 0, 0), "frost")
    b.cyl(4, 5, 10, 8, (0, 0, 6), (0, 0, 0), "ice_white")
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        b.box((0.8, 0.8, 0.8), (math.cos(a) * 10, math.sin(a) * 10, 1.8), (0, 0, 0), "glow_amber")
    ob = b.finish(mats)
    g = Builder("part_gun")
    g.sphere(3.2, (0, 0, 0), (1, 1, 0.8), 8, 6, "frost", smooth=False)
    for x in (-1, 1):
        g.cyl(0.4, 0.4, 6, 6, (x, 3.5, 1.5), (math.pi / 2 - 0.5, 0, 0), "steel")
    g.box((1.2, 0.4, 0.4), (0, 2.6, 0.6), (0, 0, 0), "glow_orange")
    g.finish(mats, ob, (0, 0, 13))
    r = Builder("part_radar")
    r.cyl(0.4, 0.4, 3, 6, (0, 0, 0), (0, 0, 0), "steel")
    r.cyl(2.6, 0.6, 1, 8, (0, 0, 2), (0.6, 0, 0), "ice_white")
    r.finish(mats, ob, (5, -3, 9))
    return ob


def build_crawler(mats):
    """Ice crawler (hulk): a tracked vehicle with a turret (part_turret) and a cab (part_cab). Nose +Y."""
    b = Builder("crawler")
    for x in (-7, 7):
        b.box((4, 26, 5), (x, 0, 0), (0, 0, 0), "gunmetal")
        for y in range(-11, 12, 4):
            b.box((4.4, 1, 5.4), (x, y, 0), (0, 0, 0), "steel")
    b.box((12, 22, 5), (0, 0, 3), (0, 0, 0), "ice_white")
    b.box((12.2, 1, 1), (0, -11, 5), (0, 0, 0), "glow_amber")
    ob = b.finish(mats)
    t = Builder("part_turret")
    t.cyl(4, 4.6, 3, 8, (0, 0, 0), (0, 0, 0), "frost")
    t.cyl(0.8, 0.8, 10, 6, (0, 6, 1), (math.pi / 2 - 0.25, 0, 0), "steel")
    t.box((1.4, 0.5, 1.4), (0, 10.8, 2.3), (0, 0, 0), "glow_orange")
    t.finish(mats, ob, (0, -3, 7))
    c = Builder("part_cab")
    c.box((8, 6, 4), (0, 0, 0), (0, 0, 0), "frost")
    c.box((7, 0.3, 1.4), (0, 3.1, 0.6), (0, 0, 0), "canopy")
    c.finish(mats, ob, (0, 9, 7))
    return ob


def build_fortress(mats):
    """The Fortress (boss, Frozen Moon): a walled base with four gun towers (part_tower0..3), two shield generators
    (part_gen0/1) and a core under a dome (part_core). Sits below the rail, facing up and +Y."""
    b = Builder("fortress")
    b.slab([(-30, -24), (30, -24), (36, 0), (30, 24), (-30, 24), (-36, 0)], -4, 4, "frost")
    b.slab([(-26, -20), (26, -20), (31, 0), (26, 20), (-26, 20), (-31, 0)], 4, 6, "ice_white")
    for k in range(12):
        a = k * math.pi / 6
        b.box((1, 1, 1), (math.cos(a) * 28, math.sin(a) * 20, 6.5), (0, 0, 0), "glow_amber")
    ob = b.finish(mats)
    for i, (x, y) in enumerate([(-24, 14), (24, 14), (-24, -14), (24, -14)]):
        t = Builder(f"part_tower{i}")
        t.cyl(3.4, 4.2, 12, 8, (0, 0, 0), (0, 0, 0), "ice_white")
        t.sphere(3.2, (0, 0, 7), (1, 1, 0.8), 8, 6, "frost", smooth=False)
        for x2 in (-1, 1):
            t.cyl(0.4, 0.4, 6, 6, (x2, 3.5, 8), (math.pi / 2 - 0.6, 0, 0), "steel")
        t.finish(mats, ob, (x, y, 10))
    for i, x in enumerate((-12, 12)):
        g = Builder(f"part_gen{i}")
        g.cyl(3, 3, 8, 10, (0, 0, 0), (0, 0, 0), "steel")
        g.cyl(3.4, 3.4, 1.4, 10, (0, 0, 2), (0, 0, 0), "glow_teal")
        g.cyl(3.4, 3.4, 1.4, 10, (0, 0, -1.5), (0, 0, 0), "glow_teal")
        g.finish(mats, ob, (x, -10, 10))
    core = Builder("part_core")
    core.sphere(8, (0, 0, 0), (1, 1, 0.65), 14, 8, "core_red", smooth=True)
    core.cyl(9, 9, 1, 14, (0, 0, -1), (0, 0, 0), "steel")
    core.finish(mats, ob, (0, 4, 8))
    return ob


# ---- location 5: The Corona


def build_mirror(mats):
    """Mirror array element (hulk): a hexagonal frame focusing sunlight through a lens (part_lens, fires the beam)
    held by two nodes (part_node0/1)."""
    b = Builder("mirror")
    hexo = [(math.cos(k * math.pi / 3) * 16, math.sin(k * math.pi / 3) * 16) for k in range(6)]
    hexi = [(math.cos(k * math.pi / 3) * 14, math.sin(k * math.pi / 3) * 14) for k in range(6)]
    b.slab(hexo, -1.2, -0.4, "gold")
    b.slab(hexi, -0.4, 0.0, "mirror")
    for x, y in hexo:
        b.box((1.2, 1.2, 1.2), (x, y, 0.2), (0, 0, 0), "glow_white")
    b.box((0.8, 0.8, 12), (0, 0, 6), (0, 0, 0), "steel")
    ob = b.finish(mats)  # the dish faces up (+Z); the game stands it up (hulk def tilt)
    lens = Builder("part_lens")
    lens.sphere(2.6, (0, 0, 0), (1, 1, 1), 10, 8, "glow_white", smooth=True)
    lens.cyl(3.2, 3.2, 0.6, 10, (0, 0, -1), (0, 0, 0), "gold")
    lens.finish(mats, ob, (0, 0, 13))
    for i, x in enumerate((-12, 12)):
        n = Builder(f"part_node{i}")
        n.ico(2.4, (0, 0, 0), (1, 1, 1), 1, "gold")
        n.box((0.8, 0.8, 0.8), (0, 0, 2.4), (0, 0, 0), "eye_red")
        n.finish(mats, ob, (x, 0, 2))
    return ob


def build_plate(mats):
    """Dyson shell plate battery (hulk): a 60×60 plate with three guns (part_gun0..2) on its face (+Z)."""
    b = Builder("plate")
    b.box((60, 60, 4), (0, 0, 0), (0, 0, 0), "obsidian")
    for k in range(-2, 3):
        b.box((60.2, 0.8, 4.2), (0, k * 12, 0), (0, 0, 0), "gold")
        b.box((0.8, 60.2, 4.2), (k * 12, 0, 0), (0, 0, 0), "gold")
    for x in (-24, 24):
        for y in (-24, 24):
            b.box((1.6, 1.6, 1), (x, y, 2.6), (0, 0, 0), "glow_white")
    ob = b.finish(mats)
    for i, (x, y) in enumerate([(-16, 8), (16, 8), (0, -14)]):
        g = Builder(f"part_gun{i}")
        g.cyl(3, 3.6, 2.4, 8, (0, 0, 0), (0, 0, 0), "steel")
        g.sphere(2.4, (0, 0, 2), (1, 1, 0.8), 8, 6, "gold", smooth=False)
        g.cyl(0.5, 0.5, 6, 6, (0, 3, 3), (math.pi / 2 - 0.6, 0, 0), "gunmetal")
        g.box((1, 0.4, 1), (0, 5.4, 4.6), (0, 0, 0), "glow_orange")
        g.finish(mats, ob, (x, y, 3.2))
    return ob


def build_gatekeeper(mats):
    """The Gatekeeper (mid-boss, The Corona): a ring station at the shell's breach, six turrets around it
    (part_t0..5) and a core at its centre (part_core). The ring faces +Y."""
    b = Builder("gatekeeper")
    n = 16
    for k in range(n):
        a0 = k * 2 * math.pi / n
        b.box((10, 6, 6), (math.cos(a0) * 28, 0, math.sin(a0) * 28), (0, -a0, 0), "obsidian")
        b.box((2, 6.4, 2), (math.cos(a0) * 31, 0, math.sin(a0) * 31), (0, -a0, 0), "gold")
    for k in range(3):
        a = k * 2 * math.pi / 3 + math.pi / 2
        b.box((2, 2, 26), (math.cos(a) * 13, 0, math.sin(a) * 13), (0, -a + math.pi / 2, 0), "steel")
    ob = b.finish(mats)
    for i in range(6):
        a = i * math.pi / 3
        t = Builder(f"part_t{i}")
        t.cyl(2.6, 3.2, 3, 8, (0, 0, 0), (math.pi / 2, 0, 0), "gold")
        t.cyl(0.6, 0.6, 5, 6, (0, 3.5, 0), (math.pi / 2, 0, 0), "gunmetal")
        t.box((1, 0.4, 1), (0, 6.2, 0), (0, 0, 0), "glow_orange")
        t.finish(mats, ob, (math.cos(a) * 28, 4, math.sin(a) * 28))
    core = Builder("part_core")
    core.ico(6, (0, 0, 0), (1, 1, 1), 2, "core_red", smooth=True)
    core.cyl(7, 7, 1, 12, (0, 0, 0), (math.pi / 2, 0, 0), "gold")
    core.finish(mats, ob, (0, 2, 0))
    return ob


def build_dreadnought(mats):
    """The Dreadnought (final boss): a black-and-gold spearhead with wing batteries (part_wingL/R), hangars
    (part_hangarL/R), a spine cannon (part_spine) and the core (part_core). Faces +Y."""
    b = Builder("dreadnought")
    b.slab([(4, 44), (16, 20), (40, 4), (50, -14), (36, -10), (20, -24), (6, -30)], -4, 4, "obsidian")
    b.slab([(16, 20), (40, 4), (41, 5), (17, 21)], -1.2, 1.2, "gold")
    b.slab([(40, 4), (50, -14), (51, -13.6), (41, 4.6)], -1.2, 1.2, "glow_white")
    b.cyl(4, 3.4, 8, 8, (14, -32, 0), (math.pi / 2, 0, 0), "steel")
    b.cyl(3.4, 3.2, 0.5, 8, (14, -36.2, 0), (math.pi / 2, 0, 0), "glow_orange")
    b.box((2, 30, 2), (28, -4, 4.5), (0, 0, -0.5), "gold")
    b.mirror_x()
    b.loft([[(0, 56, 0)] * 8, ring(40, 6, 4, 8), ring(10, 12, 8, 8), ring(-20, 12, 8, 8), ring(-34, 7, 6, 8)], "obsidian")
    b.box((4, 40, 3), (0, 10, 8.5), (0, 0, 0), "gold")
    ob = b.finish(mats)
    for name, x in (("part_wingL", -40), ("part_wingR", 40)):
        c = Builder(name)
        c.box((10, 12, 6), (0, 0, 0), (0, 0, 0), "obsidian")
        c.box((10.4, 2, 6.4), (0, -3, 0), (0, 0, 0), "gold")
        for x2 in (-3, 0, 3):
            c.cyl(0.7, 0.7, 8, 6, (x2, 8, 0.5), (math.pi / 2, 0, 0), "steel")
            c.box((1, 0.4, 1), (x2, 12.2, 0.5), (0, 0, 0), "glow_orange")
        c.finish(mats, ob, (x, 0, 2))
    for name, x in (("part_hangarL", -20), ("part_hangarR", 20)):
        c = Builder(name)
        c.box((10, 10, 6), (0, 0, 0), (0, 0, 0), "obsidian")
        c.box((8, 0.4, 4), (0, 5.2, 0), (0, 0, 0), "glow_amber")
        c.finish(mats, ob, (x, 6, -6))
    sp = Builder("part_spine")
    sp.cyl(2.4, 2.4, 20, 8, (0, 0, 0), (math.pi / 2, 0, 0), "gold")
    sp.cyl(1.2, 1.2, 6, 8, (0, 12, 0), (math.pi / 2, 0, 0), "steel")
    sp.box((1.4, 0.5, 1.4), (0, 15.2, 0), (0, 0, 0), "glow_white")
    sp.finish(mats, ob, (0, 24, 11))
    core = Builder("part_core")
    core.sphere(6, (0, 0, 0), (1, 1, 1), 14, 10, "core_red", smooth=True)
    for k in range(6):
        a = k * math.pi / 3
        core.box((2, 2, 4), (math.cos(a) * 6.6, 0, math.sin(a) * 6.6), (0, a, 0), "gold")
    core.finish(mats, ob, (0, 30, 0))
    for i, x in enumerate((14, -14)):
        empty(f"glow_{i}", (x, -37, 0), ob)
    return ob


def turret(mats, name, parent, loc, scale=1.0):
    t = Builder(name)
    s = scale
    t.cyl(1.5 * s, 1.9 * s, 1.0 * s, 8, (0, 0, 0), (0, 0, 0), "tan")
    t.box((1.6 * s, 1.8 * s, 0.9 * s), (0, -0.2 * s, 0.85 * s), (0, 0, 0), "tan")
    for x in (-0.45, 0.45):
        t.cyl(0.22 * s, 0.22 * s, 2.8 * s, 6, (x * s, 1.9 * s, 0.9 * s), (math.pi / 2, 0, 0), "steel")
        t.box((0.3 * s, 0.1 * s, 0.3 * s), (x * s, 3.32 * s, 0.9 * s), (0, 0, 0), "glow_orange")
    return t.finish(mats, parent, loc)


def build_cruiser(mats):
    b = Builder("cruiser")
    # right side: sponson, engine, armour plates; mirrored
    b.slab([(3.5, 8), (9.5, 4), (10.5, -6), (8, -14), (3.5, -15)], -1.6, 1.4, "navy")
    b.slab([(9.5, 4), (10.5, -6), (10.9, -6), (9.9, 4)], -0.4, 0.4, "glow_amber")  # side light strip
    b.cyl(2.0, 1.6, 4.0, 8, (6.5, -17, 0), (math.pi / 2, 0, 0), "steel")
    b.cyl(1.6, 1.4, 0.3, 8, (6.5, -19.1, 0), (math.pi / 2, 0, 0), "glow_orange")
    b.box((0.4, 10, 2.2), (4.2, 13, 0.2), (0, 0, 0.12), "navy_light")  # prow armour
    b.mirror_x()
    # spine hull, lofted along Y (nose at +Y)
    b.loft([
        [(0, 24, 0)] * 8,
        ring(18, 2.6, 1.8, 8),
        ring(8, 4.4, 3.0, 8),
        ring(-6, 4.8, 3.4, 8),
        ring(-16, 4.0, 3.0, 8),
        ring(-19, 2.6, 2.0, 8),
    ], "navy_light")
    b.box((3.0, 6, 3.0), (0, -8, 3.6), (0, 0, 0), "navy")  # bridge tower
    b.box((2.4, 0.2, 0.5), (0, -4.9, 4.4), (0, 0, 0), "glow_amber")  # bridge windows
    b.cyl(2.2, 1.8, 0.4, 8, (0, -20.3, 0), (math.pi / 2, 0, 0), "glow_orange")
    ob = b.finish(mats)
    # destructible parts
    for i, (x, y, z) in enumerate([(7.0, 0.0, 1.8), (-7.0, 0.0, 1.8), (2.6, 10.5, 2.4), (-2.6, 10.5, 2.4)]):
        turret(mats, f"part_turret{i}", ob, (x, y, z), 1.05)
    core = Builder("part_core")
    core.sphere(2.6, (0, 0, 0), (1, 1, 1), 12, 8, "core_red", smooth=True)
    core.cyl(3.0, 3.0, 0.5, 12, (0, 0, 0), (math.pi / 2, 0, 0), "steel")
    core.finish(mats, ob, (0, 21.5, 0.3))
    for i, x in enumerate((6.5, -6.5, 0)):
        empty(f"glow_{i}", (x, -19.6, 0), ob)
    return ob


def build_carrier(mats):
    b = Builder("carrier")
    # right side nacelle + deck edge, mirrored
    b.loft([ring(50, 3.0, 3.0, 8, cx=19, cz=-2), ring(-40, 4.5, 4.5, 8, cx=19, cz=-2), ring(-62, 4.0, 4.0, 8, cx=19, cz=-2)], "hull_grey")
    b.cyl(3.8, 3.4, 0.6, 8, (19, -62.4, -2), (math.pi / 2, 0, 0), "glow_blue")
    b.box((8, 60, 1.2), (14, -5, -2), (0, 0, 0), "hull_grey")  # pylon
    b.box((0.4, 100, 0.5), (13, 0, 4.3), (0, 0, 0), "accent_blue")  # deck edge stripe
    b.mirror_x()
    # main hull (nose +Y), flat deck on top
    b.loft([
        [(-4, 70, 0), (4, 70, 0), (5, 70, 1), (-5, 70, 1)],
        [(-11, 50, -5), (11, 50, -5), (13, 50, 4), (-13, 50, 4)],
        [(-12, -50, -6), (12, -50, -6), (13, -50, 4), (-13, -50, 4)],
        [(-10, -66, -4), (10, -66, -4), (11, -66, 4), (-11, -66, 4)],
    ], "hull_white")
    b.box((22, 90, 0.3), (0, -2, 4.1), (0, 0, 0), "deck")
    for i in range(9):
        b.box((0.5, 3, 0.1), (0, 40 - i * 10, 4.3), (0, 0, 0), "glow_amber")  # runway centreline
    b.box((7, 20, 13), (-9, -20, 10), (0, 0, 0), "hull_white")  # island
    b.box((7.2, 3, 2), (-9, -9.6, 14), (0, 0, 0), "canopy")  # island bridge
    # stern landing bay (faces the player who arrives from behind)
    b.box((14, 2, 7), (0, -66.2, 0), (0, 0, 0), "glow_blue")
    b.box((16, 1.5, 1), (0, -66.4, 4.5), (0, 0, 0), "accent_orange")
    ob = b.finish(mats)
    for i, x in enumerate((19, -19)):
        empty(f"glow_{i}", (x, -63, -2), ob)
    empty("glow_2", (0, -67.5, 0), ob)
    return ob


def build_mothership(mats):
    b = Builder("mothership")
    # right half: crescent wing, mirrored
    b.slab([(6, 16), (24, 12), (40, 2), (46, -10), (38, -6), (24, -2), (8, -10)], -2.5, 2.5, "violet")
    b.slab([(24, 12), (40, 2), (41, 3), (25, 13)], -0.8, 0.8, "glow_violet")  # leading edge light
    b.box((10, 3, 1.5), (30, -4, 3.0), (0, 0, -0.35), "violet_light")
    for k in range(3):
        b.box((1.2, 0.3, 0.4), (14 + k * 7, 13.6 - k * 1.7, 0), (0, 0, -0.25), "glow_violet")
    b.cyl(2.4, 2.0, 3.0, 8, (18, -11, 0), (math.pi / 2, 0, 0), "steel")
    b.cyl(2.0, 1.8, 0.3, 8, (18, -12.6, 0), (math.pi / 2, 0, 0), "glow_violet")
    b.mirror_x()
    # central disc body
    b.loft([ring(-12, 10, 5, 12, phase=math.pi / 12), ring(0, 16, 7, 12, phase=math.pi / 12), ring(10, 12, 5, 12, phase=math.pi / 12), ring(14, 6, 3, 12, phase=math.pi / 12)], "violet_light")
    b.cyl(9, 9, 1, 12, (0, -12.5, 0), (math.pi / 2, 0, 0), "glow_violet")
    b.box((4, 8, 4), (0, -2, 8), (0, 0, 0), "violet")  # dorsal spire
    b.box((3, 0.3, 0.8), (0, 2.1, 9), (0, 0, 0), "eye_red")
    ob = b.finish(mats)

    def cannon(name, loc):
        c = Builder(name)
        c.box((6, 10, 5), (0, 0, 0), (0, 0, 0), "violet_light")
        c.box((6.4, 2, 5.4), (0, -2, 0), (0, 0, 0), "violet")
        for x in (-1.5, 1.5):
            c.cyl(0.6, 0.6, 7, 8, (x, 7.5, 0), (math.pi / 2, 0, 0), "steel")
            c.box((0.8, 0.2, 0.8), (x, 11.1, 0), (0, 0, 0), "glow_orange")
        return c.finish(mats, ob, loc)

    def bay(name, loc):
        c = Builder(name)
        c.box((8, 7, 5), (0, 0, 0), (0, 0, 0), "violet")
        c.box((6, 0.4, 3), (0, 3.6, 0), (0, 0, 0), "glow_amber")
        c.box((8.4, 1, 0.6), (0, 3.4, 2.6), (0, 0, 0), "violet_light")
        return c.finish(mats, ob, loc)

    cannon("part_wingL", (-36, 2, 2.5))
    cannon("part_wingR", (36, 2, 2.5))
    bay("part_bayL", (-16, 8, -5))
    bay("part_bayR", (16, 8, -5))
    core = Builder("part_core")
    core.sphere(5.0, (0, 0, 0), (1, 1, 1), 14, 10, "core_red", smooth=True)
    for k in range(6):
        a = k * math.pi / 3
        core.box((1.6, 1.6, 3.6), (math.cos(a) * 5.6, 0, math.sin(a) * 5.6), (0, a, 0), "steel")
    core.finish(mats, ob, (0, 15, 0))
    for i, x in enumerate((18, -18)):
        empty(f"glow_{i}", (x, -13, 0), ob)
    return ob


# --------------------------------------------------------------------------------------------
# export + previews


def select_tree(root):
    bpy.ops.object.select_all(action="DESELECT")
    stack = [root]
    while stack:
        o = stack.pop()
        o.select_set(True)
        stack.extend(o.children)


def export(roots, path):
    bpy.ops.object.select_all(action="DESELECT")
    for r in roots:
        stack = [r]
        while stack:
            o = stack.pop()
            o.select_set(True)
            stack.extend(o.children)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=False,
        export_normals=True,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
    )
    print("exported", path, os.path.getsize(path), "bytes")


def tri_count(root):
    n = 0
    stack = [root]
    while stack:
        o = stack.pop()
        if o.type == "MESH":
            n += sum(len(p.vertices) - 2 for p in o.data.polygons)
        stack.extend(o.children)
    return n


def previews(roots, out_dir):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_WORKBENCH"
    except TypeError as e:
        print("workbench unavailable", e)
        return
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_cavity = False
    scene.render.resolution_x = 420
    scene.render.resolution_y = 300
    scene.render.film_transparent = False
    scene.world = scene.world or bpy.data.worlds.new("w")
    cam_data = bpy.data.cameras.new("pcam")
    cam = bpy.data.objects.new("pcam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    os.makedirs(out_dir, exist_ok=True)
    for r in roots:
        for o in bpy.data.objects:
            o.hide_render = o.type in ("MESH",)
        stack = [r]
        size = 0
        while stack:
            o = stack.pop()
            o.hide_render = False
            if o.type == "MESH":
                size = max(size, max(o.dimensions))
            stack.extend(o.children)
        for view, d in (("rear", Vector((0.0, -1.0, 0.45))), ("front", Vector((0.25, 1.0, 0.35))), ("top", Vector((0.15, -0.3, 1.0)))):
            cam.location = d.normalized() * size * 1.9
            cam.rotation_euler = (-d).to_track_quat("-Z", "Z").to_euler()
            cam_data.lens = 50
            scene.render.filepath = os.path.join(out_dir, f"{r.name}_{view}.png")
            bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = make_materials()
    ships = [build_player(mats), build_drone(mats), build_dart(mats), build_wasp(mats), build_hammer(mats), build_mine(mats),
             build_miner(mats), build_shade(mats), build_cruiser(mats), build_carrier(mats)]
    boss = [build_mothership(mats)]
    locs = {
        "loc2": [build_hauler(mats), build_driver(mats), build_refinery(mats), build_excavator(mats)],
        "loc3": [build_battleship(mats), build_flagship(mats)],
        "loc4": [build_groundgun(mats), build_crawler(mats), build_fortress(mats)],
        "loc5": [build_mirror(mats), build_plate(mats), build_gatekeeper(mats), build_dreadnought(mats)],
    }
    every = ships + boss + [r for v in locs.values() for r in v]
    # spread them out for previews / inspection
    for i, r in enumerate(every):
        r.location.x = i * 300
    for r in every:
        print(f"{r.name:12s} {tri_count(r):6d} tris  dims {tuple(round(v, 1) for v in r.dimensions)}")
    os.makedirs(OUT_DIR, exist_ok=True)
    for r in every:
        r.location.x = 0
    export(ships, os.path.join(OUT_DIR, "ships.raw.glb"))
    export(boss, os.path.join(OUT_DIR, "boss.raw.glb"))
    for name, roots in locs.items():
        export(roots, os.path.join(OUT_DIR, f"{name}.raw.glb"))
    if PREVIEW_DIR:
        only = os.environ.get("PREVIEW_ONLY", "").split(",")
        previews([r for r in every if not only[0] or r.name in only], PREVIEW_DIR)


main()
