"""Bundle buildings, towers, plots and farmland for the app to fetch at runtime.

Pure reorganisation of the browser-decoded model: no Boolean operations, so it
runs anywhere, unlike the structure partition.

The towers are separated from the ordinary buildings here rather than in Rhino,
where they share the 建筑楼板 layer. They are the floor-plate clusters that
stand on the deck AND rise past 100m; the west-side blocks also stand on the
deck but top out at 33m.
"""
import gzip, json
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'data/final-model-parsed.json.gz'
OUT = ROOT / 'data/app-extras.json.gz'

PLATE_MAX_T = 2.0
PLATE_MIN_Z = 10.0
TOWER_MIN_TOP = 100.0
TOWER_CLUSTER_R = 25.0

src = json.loads(gzip.decompress(SRC.read_bytes()))
B = src['extras']['building']

plates = [e for e in B if e['height'] <= PLATE_MAX_T and e['minZ'] >= PLATE_MIN_Z]
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
towers = sorted([c for c in groups.values() if max(e['maxZ'] for e in c) > TOWER_MIN_TOP],
                key=lambda c: -max(e['maxZ'] for e in c))
tower_ids = {e['id'] for c in towers for e in c}

SLAB_BOTTOM = 0.0    # the site's top face; the roads are a slab from 0 down to -1

def thicken(mesh, bottom=SLAB_BOTTOM):
    """Turn a single-surface sheet into a closed slab.

    The plots and the farmland come out of Rhino as one-sided surfaces at
    z=0.5, so at the site edge they end in a knife edge against the dark base
    while the road beside them shows a proper 1m slab. Extruding them down to
    the site's top face gives them the same kerb.
    """
    v = np.asarray(mesh['v'], dtype=np.float64).reshape(-1, 3)
    t = np.asarray(mesh['t'], dtype=np.int64).reshape(-1, 3)
    if len(t) == 0 or v[:, 2].min() <= bottom:
        return mesh
    # The source normals face down, so turn every top face upward first.
    n = np.cross(v[t[:, 1]] - v[t[:, 0]], v[t[:, 2]] - v[t[:, 0]])
    t = np.where((n[:, 2] < 0)[:, None], t[:, [0, 2, 1]], t)
    nv = len(v)
    vb = v.copy(); vb[:, 2] = bottom
    V = np.vstack([v, vb])
    Tb = t[:, [0, 2, 1]] + nv
    edges = np.vstack([t[:, [0, 1]], t[:, [1, 2]], t[:, [2, 0]]])
    key = np.sort(edges, axis=1)
    _, idx, cnt = np.unique(key, axis=0, return_index=True, return_counts=True)
    bnd = edges[idx[cnt == 1]]
    a, b = bnd[:, 0], bnd[:, 1]
    # With the top faces wound CCW seen from above, the interior lies to the left
    # of a boundary edge a->b, so the wall's outward normal is down x edge.
    walls = np.vstack([np.c_[a, a + nv, b + nv], np.c_[a, b + nv, b]])
    T = np.vstack([t, Tb, walls])
    P = V[T]
    vol = np.einsum('ij,ij->i', P[:, 0], np.cross(P[:, 1], P[:, 2])).sum() / 6.0
    plan = np.abs(np.cross(P[:len(t), 1] - P[:len(t), 0],
                           P[:len(t), 2] - P[:len(t), 0])[:, 2]).sum() / 2.0
    # A closed, consistently wound slab has every directed edge exactly once and
    # encloses exactly plan x height. Winding the walls the other way still
    # passes an undirected edge count, and silently loses two thirds of the
    # volume, so check the thing that actually distinguishes them.
    de = np.vstack([T[:, [0, 1]], T[:, [1, 2]], T[:, [2, 0]]])
    _, counts = np.unique(de, axis=0, return_counts=True)
    assert (counts == 1).all(), 'slab winding is inconsistent'
    expect = plan * (v[:, 2].max() - bottom)
    assert abs(vol - expect) < max(1e-6, expect * 1e-6), (vol, expect)
    return {'v': V.reshape(-1).tolist(), 't': T.reshape(-1).tolist()}

def trim(e, kind):
    return {'id': e['id'], 'kind': kind, 'mesh': e['mesh'],
            'minZ': e['minZ'], 'maxZ': e['maxZ'], 'height': e['height'],
            'area': e['area'], 'center': e['center'], 'size': e['size']}

out = {'meta': {'source': SRC.name, 'origin': src['meta']['origin'],
                'siteArea': src['meta']['siteArea'], 'roadArea': src['meta']['roadArea']},
       'towers': [], 'buildings': [], 'plots': [], 'agri': []}

for n, c in enumerate(towers, 1):
    c = sorted(c, key=lambda e: e['minZ'])
    out['towers'].append({
        'id': 'T-%02d' % n, 'floors': len(c),
        'minZ': min(e['minZ'] for e in c), 'maxZ': max(e['maxZ'] for e in c),
        'typicalArea': float(np.median([e['area'] for e in c])),
        'gfa': float(sum(e['area'] for e in c)),
        'plates': [trim(e, 'plate') for e in c]})

out['buildings'] = [trim(e, 'plate' if e['height'] <= PLATE_MAX_T else 'solid')
                    for e in B if e['id'] not in tower_ids]
out['plots'] = [trim(e, 'plot') for e in src['extras']['plots'] if e['area'] > 1.0]
out['agri'] = [trim(e, 'agri') for e in src['extras']['agri']]
for e in out['plots'] + out['agri']:
    e['mesh'] = thicken(e['mesh'])
    e['minZ'] = SLAB_BOTTOM

blob = gzip.compress(json.dumps(out, separators=(',', ':'), ensure_ascii=False).encode(), mtime=0)
OUT.write_bytes(blob)
print('towers    %d  (%s)' % (len(out['towers']),
      ', '.join('%s %d层 顶%.1fm GFA %.0f㎡' % (t['id'], t['floors'], t['maxZ'], t['gfa'])
                for t in out['towers'])))
print('buildings %d' % len(out['buildings']))
print('plots     %d  (%d dropped as degenerate)'
      % (len(out['plots']), len(src['extras']['plots']) - len(out['plots'])))
print('agri      %d' % len(out['agri']))
print('%s  %.2f MB' % (OUT.name, len(blob) / 1048576))
