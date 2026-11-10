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
import trimesh
import manifold3d as mf
from shapely.geometry import Polygon
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'data/final-model-parsed.json.gz'
OUT = ROOT / 'data/final-structure-solids.json.gz'
WELD = 1e-4          # 0.1 mm: Brep render meshes are per-face and unstitched
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

def heal(v, t, name):
    """Weld the per-face render mesh, then repair until it is a volume."""
    m = trimesh.Trimesh(v, t, process=True, validate=True)   # merges duplicate vertices
    report('welded', m)
    if m.is_volume:
        return m
    trimesh.repair.fix_normals(m, multibody=True)
    trimesh.repair.fix_winding(m)
    trimesh.repair.fix_inversion(m, multibody=True)
    m.remove_degenerate_faces(); m.remove_duplicate_faces(); m.remove_unreferenced_vertices()
    report('repaired', m)
    if m.is_volume:
        return m
    # Last resort: let the Boolean kernel re-derive a manifold from the shell.
    # It keeps the geometry and discards the self-touching faces that make the
    # mesh non-manifold -- a small local error in exchange for a usable solid.
    try:
        man = mf.Manifold(mf.Mesh(np.float32(m.vertices), np.uint32(m.faces)))
        if man.status() == mf.Error.NoError:
            mm = man.to_mesh()
            m = trimesh.Trimesh(mm.vert_properties[:, :3], mm.tri_verts, process=False)
            report('kernel-rebuilt', m)
            if m.is_volume:
                return m
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
                    if (np.asarray(u['mesh']['v']).reshape(-1, 3)[:, 2].ptp()) < FLAT],
}, 'whole': {'id': '全部结构 · 最终模型', 'kind': 'whole',
             'mesh': pack(source), 'topology': stats(source)}, 'units': []}

zmin, zmax = source.bounds[:, 2]
remaining_mf = source_mf
claimed = None
for u in sorted(old['units'], key=lambda u: u['id']):
    v = np.asarray(u['mesh']['v']).reshape(-1, 3)
    f = np.asarray(u['mesh']['t']).reshape(-1, 3)
    poly = unary_union([Polygon(v[tri, :2]) for tri in f if Polygon(v[tri, :2]).area > 1e-8])
    # Clean numerical seam slivers below 0.2 mm, not architectural gaps.
    poly = poly.buffer(.0002).buffer(-.0002).simplify(.0001, preserve_topology=True)
    if claimed is not None:
        poly = poly.difference(claimed)
    claimed = poly if claimed is None else unary_union([claimed, poly])
    polygons = list(poly.geoms) if poly.geom_type == 'MultiPolygon' else [poly]
    contours = []
    for p in polygons:
        if p.area < 1e-7:
            continue
        contours.append(np.array(p.exterior.coords)[:-1])
        contours.extend(np.array(r.coords)[:-1] for r in p.interiors)
    if not contours:
        continue
    cutter = mf.CrossSection(contours, mf.FillRule.EvenOdd).extrude(zmax - zmin + 4).translate([0, 0, zmin - 2])
    cut = remaining_mf ^ cutter
    assert cut.status() == mf.Error.NoError
    solid = from_mf(cut)
    if solid.is_empty:
        continue
    remaining_mf = remaining_mf - cutter
    entry = {k: val for k, val in u.items() if k != 'mesh'}
    entry.update(mesh=pack(solid), topology=stats(solid))
    result['units'].append(entry)
    print('%-8s faces=%-7d volume=%.3f' % (u['id'], len(solid.faces), solid.volume), flush=True)

# Everything outside the legacy masks -- the parts that now rise with the towers.
remaining = from_mf(remaining_mf)
if not remaining.is_empty:
    result['units'].append({'id': 'R-新增及未分配区域', 'kind': 'remainder',
                            'mesh': pack(remaining), 'topology': stats(remaining)})
    print('remainder volume=%.3f' % remaining.volume, flush=True)

result['meta']['emptyLegacyGroups'] = [u['id'] for u in old['units']
                                       if u['id'] not in {p['id'] for p in result['units']}]
result['meta']['sourceVolume'] = float(source.volume)
result['meta']['partsVolume'] = sum(u['topology']['volume'] for u in result['units'])
err = abs(result['meta']['partsVolume'] - source.volume) / source.volume
print('\nvolume source=%.3f parts=%.3f err=%.2e' % (source.volume, result['meta']['partsVolume'], err), flush=True)
assert err < 1e-5, 'Partition lost or duplicated volume'

OUT.write_bytes(gzip.compress(json.dumps(result, separators=(',', ':'), ensure_ascii=False).encode(), mtime=0))
print('VERIFIED %d units -> %s (%.1f MB)' % (len(result['units']), OUT.name, OUT.stat().st_size / 1048576), flush=True)
