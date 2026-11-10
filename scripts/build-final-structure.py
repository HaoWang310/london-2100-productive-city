"""Partition the final Rhino structure into display solids, using legacy XY regions.

Source is the model decoded in the browser and exported from the import panel,
so neither rhino3dm nor the 96.8MB .3dm is needed here. The browser is the only
decoder available: the build container cannot reach npm, pypi or any CDN.

All cut surfaces come from solid Boolean operations. No vertex is extruded or
thickened. Total volume is asserted against the welded source.

Requires: numpy, trimesh, shapely, mapbox-earcut, manifold3d.
"""
import base64, gzip, hashlib, json, re, sys
from pathlib import Path
import numpy as np
from scipy.spatial import cKDTree
import trimesh
import manifold3d as mf
from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'data/final-model-parsed.json.gz'
OUT = ROOT / 'data/final-structure-solids.json.gz'
WELD = 1e-4          # 0.1 mm: Brep render meshes are per-face and unstitched
PLATE_MAX_T = 2.0    # thicker than this and it is not a floor plate
PLATE_MIN_Z = 10.0   # plates below this sit on the ground, not on the deck
TOWER_MIN_TOP = 100.0  # the west-side mid-rises top out at 33m; the towers at 259 and 327
TOWER_CLUSTER_R = 25.0 # plates of one tower share a plan position
TOWER_FOOT_BUFFER = 4.0  # the two towers are 9.8m apart, so stay well inside that
REMAINDER_MIN_VOLUME = 1.0   # measured: 69 bodies carry 100.0% of the leftover volume,
                             # the other 729 are numerically zero. The cut is not a judgement.
FLAT = 1e-6          # a part with no thickness cannot take part in a solid boolean

old = json.loads(gzip.decompress(base64.b64decode(
    re.search(r"MODEL_GZIP\s*=\s*['\"]([^'\"]+)", (ROOT / 'index.html').read_text())[1])))
src = json.loads(gzip.decompress(SRC.read_bytes()))

assert np.allclose(old['meta']['origin'], src['meta']['origin'], atol=1e-3), \
    'The legacy XY regions only apply while both models share one origin'

def as_mesh(u):
    v = np.asarray(u['mesh']['v'], dtype=np.float64).reshape(-1, 3)
    t = np.asarray(u['mesh']['t'], dtype=np.int64).reshape(-1, 3)
    return v, t

def report(tag, m):
    counts = np.bincount(m.edges_unique_inverse)
    print('   %-22s V=%-7d T=%-7d boundary=%-6d nonmanifold=%-5d volume=%s watertight=%s'
          % (tag, len(m.vertices), len(m.faces), int((counts == 1).sum()),
             int((counts > 2).sum()), m.is_volume, m.is_watertight), flush=True)

def weld(v, t, tol=WELD):
    """Stitch a per-face Brep render mesh by snapping vertices to a tol grid.

    trimesh's own process=True is not used for this: it also drops duplicate
    faces, and where two parts of this structure touch face to face that opens
    real holes -- measured on S-02, it turned a closed shell into 58 boundary
    edges. Snapping alone closes it with none.
    """
    key = np.round(v / tol).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    vv = v[first]
    tt = inv[t]
    keep = (tt[:, 0] != tt[:, 1]) & (tt[:, 1] != tt[:, 2]) & (tt[:, 0] != tt[:, 2])
    return vv, tt[keep]

def heal(v, t, name):
    """Weld first, then repair only if the welded shell is still not a volume."""
    vv, tt = weld(v, t)
    m = trimesh.Trimesh(vv, tt, process=False)
    report('welded', m)
    if not m.is_volume:
        trimesh.repair.fix_winding(m)
        trimesh.repair.fix_inversion(m, multibody=True)
        trimesh.repair.fix_normals(m, multibody=True)
        report('repaired', m)
    if m.is_volume:
        return m
    # Last resort: let the Boolean kernel re-derive a manifold from the shell.
    # It keeps the geometry and discards the self-touching faces that make the
    # mesh non-manifold -- a small local error in exchange for a usable solid.
    try:
        man = mf.Manifold(mf.Mesh(np.float32(m.vertices), np.uint32(m.faces)))
        print('   kernel status: %s' % (man.status(),), flush=True)
        mm = man.to_mesh()
        m2 = trimesh.Trimesh(mm.vert_properties[:, :3], mm.tri_verts, process=False)
        report('kernel-rebuilt', m2)
        if m2.is_volume:
            return m2
    except Exception as exc:
        print('   kernel rebuild failed: %r' % (exc,), flush=True)
    raise SystemExit('%s could not be made into a solid; fix it in Rhino' % name)

solids = []
for u in src['units']:
    v, t = as_mesh(u)
    thickness = float(v[:, 2].max() - v[:, 2].min())
    print('%s  V=%d T=%d thickness=%.3f' % (u['id'], len(v), len(t), thickness), flush=True)
    if thickness < FLAT:
        print('   skipped: flat sheet, carries no volume', flush=True)
        continue
    solids.append((u['id'], heal(v, t, u['id'])))

assert solids, 'No structure solid survived'
print('\nsolids kept: %s' % ', '.join(i for i, _ in solids), flush=True)

def to_mf(m):
    man = mf.Manifold(mf.Mesh(np.float32(m.vertices), np.uint32(m.faces)))
    assert man.status() == mf.Error.NoError, man.status()
    return man

def from_mf(man):
    mm = man.to_mesh()
    return trimesh.Trimesh(mm.vert_properties[:, :3], mm.tri_verts, process=False)

source_mf = to_mf(solids[0][1])
for _, m in solids[1:]:
    source_mf = source_mf + to_mf(m)
assert source_mf.status() == mf.Error.NoError
source = from_mf(source_mf)
print('union: V=%d T=%d volume=%.1f' % (len(source.vertices), len(source.faces), source.volume), flush=True)

def pack(m):
    return {'v': m.vertices.reshape(-1).tolist(), 't': m.faces.reshape(-1).tolist()}

def xy_union(meshes):
    """Union of the plan footprints of a set of {'v','t'} meshes."""
    polys = []
    for mesh in meshes:
        v = np.asarray(mesh['v']).reshape(-1, 3)
        f = np.asarray(mesh['t']).reshape(-1, 3)
        for tri in f:
            poly = Polygon(v[tri, :2])
            if poly.area > 1e-8:
                polys.append(poly)
    return unary_union(polys)

def cut_region(poly, remaining_mf, zmin, zmax):
    """Intersect the remaining solid with a plan region; returns (piece, rest)."""
    polygons = list(poly.geoms) if poly.geom_type == 'MultiPolygon' else [poly]
    contours = []
    for p in polygons:
        if p.area < 1e-7:
            continue
        contours.append(np.array(p.exterior.coords)[:-1])
        contours.extend(np.array(r.coords)[:-1] for r in p.interiors)
    if not contours:
        return None, remaining_mf
    cutter = mf.CrossSection(contours, mf.FillRule.EvenOdd).extrude(
        zmax - zmin + 4).translate([0, 0, zmin - 2])
    cut = remaining_mf ^ cutter
    assert cut.status() == mf.Error.NoError
    return from_mf(cut), remaining_mf - cutter

def tower_clusters():
    """The two towers, as clusters of floor plates sharing a plan position.

    Selecting on height alone is not enough: the west-side blocks also sit on
    the deck, but they top out at 33m against the towers' 259m and 327m.
    """
    plates = [e for e in src['extras']['building']
              if e['height'] <= PLATE_MAX_T and e['minZ'] >= PLATE_MIN_Z]
    par = list(range(len(plates)))
    def find(a):
        while par[a] != a:
            par[a] = par[par[a]]; a = par[a]
        return a
    for i in range(len(plates)):
        for j in range(i + 1, len(plates)):
            if (abs(plates[i]['center'][0] - plates[j]['center'][0]) < TOWER_CLUSTER_R
                    and abs(plates[i]['center'][1] - plates[j]['center'][1]) < TOWER_CLUSTER_R):
                a, b = find(i), find(j)
                if a != b:
                    par[a] = b
    groups = {}
    for i in range(len(plates)):
        groups.setdefault(find(i), []).append(plates[i])
    towers = [c for c in groups.values() if max(e['maxZ'] for e in c) > TOWER_MIN_TOP]
    return sorted(towers, key=lambda c: -max(e['maxZ'] for e in c))

def stats(m):
    counts = np.bincount(m.edges_unique_inverse)
    return {'closed': bool(m.is_watertight), 'boundaryEdges': int((counts == 1).sum()),
            'nonManifoldEdges': int((counts > 2).sum()), 'volume': float(m.volume)}

result = {'meta': {
    'source': SRC.name,
    'sha256': hashlib.sha256(SRC.read_bytes()).hexdigest(),
    'method': ('浏览器解码的最终模型；按旧 58 单元 XY 投影区域做实体布尔交集，'
               '重叠区域依编号依次分配；剩余结构单独保留。不是原始施工分件。'),
    'origin': src['meta']['origin'],
    'weldTolerance': WELD,
    'skippedFlat': [u['id'] for u in src['units']
                    if np.ptp(np.asarray(u['mesh']['v']).reshape(-1, 3)[:, 2]) < FLAT],
}, 'whole': {'id': '全部结构 · 最终模型', 'kind': 'whole',
             'mesh': pack(source), 'topology': stats(source)}, 'units': []}

zmin, zmax = source.bounds[:, 2]
remaining_mf = source_mf
claimed = None
pieces = []          # (entry without mesh, trimesh) until the fragments are folded in
for u in sorted(old['units'], key=lambda u: u['id']):
    v = np.asarray(u['mesh']['v']).reshape(-1, 3)
    f = np.asarray(u['mesh']['t']).reshape(-1, 3)
    poly = unary_union([Polygon(v[tri, :2]) for tri in f if Polygon(v[tri, :2]).area > 1e-8])
    # Clean numerical seam slivers below 0.2 mm, not architectural gaps.
    poly = poly.buffer(.0002).buffer(-.0002).simplify(.0001, preserve_topology=True)
    if claimed is not None:
        poly = poly.difference(claimed)
    claimed = poly if claimed is None else unary_union([claimed, poly])
    solid, remaining_mf = cut_region(poly, remaining_mf, zmin, zmax)
    if solid is None or solid.is_empty or solid.volume <= 0:
        continue
    pieces.append(({k: val for k, val in u.items() if k != 'mesh'}, solid))
    print('%-8s faces=%-7d volume=%.3f' % (u['id'], len(solid.faces), solid.volume), flush=True)

# What the legacy masks never covered is the structure that now rises with the
# towers, reaching z=91 where the old deck stopped at 22. As one lump it would
# appear in the assembly as a single enormous piece, so it is cut by each
# tower's own floor-plate footprint rather than an invented radius.
towers = tower_clusters()
print('\ntowers found: %d' % len(towers), flush=True)
for n, cluster in enumerate(towers, 1):
    foot = xy_union([e['mesh'] for e in cluster]).buffer(TOWER_FOOT_BUFFER)
    piece, remaining_mf = cut_region(foot, remaining_mf, zmin, zmax)
    top = max(e['maxZ'] for e in cluster)
    if piece is None or piece.is_empty or piece.volume <= 0:
        print('T-%02d  no structure claimed' % n, flush=True)
        continue
    pieces.append(({'id': 'T-%02d 塔%d 结构' % (n, n), 'kind': 'tower',
                    'plates': len(cluster), 'towerTop': round(top, 2)}, piece))
    print('T-%02d  plates=%-4d top=%7.1f  faces=%-7d volume=%.3f'
          % (n, len(cluster), top, len(piece.faces), piece.volume), flush=True)

# Whatever neither the legacy regions nor the towers claimed comes out as
# thousands of disjoint bodies: the legacy region edges do not follow the new
# structure, so every seam leaves slivers. The bodies worth seeing become units
# of their own; the slivers are merged into the nearest piece rather than
# dropped, because discarding them would break the volume check that is the
# only guarantee this partition is right.
remaining = from_mf(remaining_mf)
if not remaining.is_empty and remaining.volume > 0:
    bodies = [b for b in remaining.split(only_watertight=False) if b.volume > 0]
    vols = np.sort([b.volume for b in bodies])[::-1]
    print('\nremainder: %d bodies, volume %.3f' % (len(bodies), remaining.volume), flush=True)
    print('   largest 12: %s' % ' '.join('%.1f' % v for v in vols[:12]), flush=True)
    for q in (50, 75, 90, 95, 99):
        print('   p%-3d %.3f' % (q, np.percentile(vols, q)), flush=True)
    for cut in (1, 5, 20, 50, 100, 500):
        keep = vols[vols >= cut]
        print('   >=%-5g  %4d bodies  %.1f%% of remainder volume'
              % (cut, len(keep), 100 * keep.sum() / vols.sum()), flush=True)
    big = [b for b in bodies if b.volume >= REMAINDER_MIN_VOLUME]
    small = [b for b in bodies if b.volume < REMAINDER_MIN_VOLUME]
    big.sort(key=lambda b: -b.volume)
    for n, b in enumerate(big, 1):
        pieces.append(({'id': 'R-%02d 新增结构' % n, 'kind': 'remainder'}, b))
        print('R-%02d  faces=%-7d volume=%.3f' % (n, len(b.faces), b.volume), flush=True)
    if small:
        centres = np.array([p[1].centroid for p in pieces])
        tree = cKDTree(centres)
        _, idx = tree.query(np.array([b.centroid for b in small]))
        merged = {}
        for b, i in zip(small, idx):
            merged.setdefault(int(i), []).append(b)
        for i, group in merged.items():
            entry, mesh = pieces[i]
            pieces[i] = (entry, trimesh.util.concatenate([mesh] + group))
        print('   merged %d slivers (%.3f volume) into %d pieces'
              % (len(small), sum(b.volume for b in small), len(merged)), flush=True)

for entry, mesh in pieces:
    entry = dict(entry)
    entry.update(mesh=pack(mesh), topology=stats(mesh))
    result['units'].append(entry)

result['meta']['emptyLegacyGroups'] = [u['id'] for u in old['units']
                                       if u['id'] not in {p['id'] for p in result['units']}]
result['meta']['sourceVolume'] = float(source.volume)
result['meta']['partsVolume'] = sum(u['topology']['volume'] for u in result['units'])
err = abs(result['meta']['partsVolume'] - source.volume) / source.volume
print('\nvolume source=%.3f parts=%.3f err=%.2e' % (source.volume, result['meta']['partsVolume'], err), flush=True)
assert err < 1e-5, 'Partition lost or duplicated volume'

OUT.write_bytes(gzip.compress(json.dumps(result, separators=(',', ':'), ensure_ascii=False).encode(), mtime=0))
print('VERIFIED %d units -> %s (%.1f MB)' % (len(result['units']), OUT.name, OUT.stat().st_size / 1048576), flush=True)
