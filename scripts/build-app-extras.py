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
