"""Rebuild display solids from published Rhino SubD, using legacy XY regions.
Requires rhino3dm, trimesh, shapely, mapbox-earcut, manifold3d, numpy.
No source vertex extrusion/thickening. All cut surfaces come from solid Boolean operations.
"""
import base64, gzip, hashlib, json, re
from pathlib import Path
import numpy as np
import rhino3dm
import trimesh
import manifold3d as mf
from shapely.geometry import Polygon
from shapely.ops import unary_union
ROOT=Path(__file__).resolve().parents[1]
old=json.loads(gzip.decompress(base64.b64decode(re.search(r"MODEL_GZIP\s*=\s*['\"]([^'\"]+)", (ROOT/'index.html').read_text())[1])))
doc=rhino3dm.File3dm.Read(str(ROOT/'2.3dm'))
parts=[]
for obj in doc.Objects:
    if not isinstance(obj.Geometry,rhino3dm.SubD): continue
    if '结构' not in doc.Layers[obj.Attributes.LayerIndex].Name: continue
    sub=obj.Geometry
    assert sub.IsSolid
    sub.Subdivide(2)
    mesh=rhino3dm.Mesh.CreateFromSubDControlNet(sub,False)
    v=np.array([[p.X,p.Y,p.Z] for p in mesh.Vertices])-old['meta']['origin']
    f=[]
    for a,b,c,d in mesh.Faces:
        f.append([a,b,c])
        if c!=d: f.append([a,c,d])
    m=trimesh.Trimesh(v,f,process=True)
    m.fix_normals(multibody=True)
    assert m.is_volume
    parts.append(m)
assert len(parts)==1
source=parts[0]
source_mf=mf.Manifold(mf.Mesh(np.float32(source.vertices),np.uint32(source.faces)))
assert source_mf.status()==mf.Error.NoError
remaining_mf=source_mf
def from_mf(m):
    mm=m.to_mesh();return trimesh.Trimesh(mm.vert_properties[:,:3],mm.tri_verts,process=False)
def pack(m):
    return {'v':m.vertices.reshape(-1).tolist(),'t':m.faces.reshape(-1).tolist()}
def stats(m):
    counts=np.bincount(m.edges_unique_inverse)
    return {'closed':bool(m.is_watertight),'boundaryEdges':int(sum(counts==1)), 'nonManifoldEdges':int(sum(counts>2)), 'volume':float(m.volume)}
result={'meta':{'source':'2.3dm','sha256':hashlib.sha256((ROOT/'2.3dm').read_bytes()).hexdigest(),'method':'SubD 两级细分网格；按旧分组 XY 投影区域做实体布尔交集，重叠区域依编号依次分配；剩余结构单独保留。不是原始施工分件。','origin':old['meta']['origin']},'whole':{'id':'全部结构 · 2.3dm','kind':'whole','mesh':pack(source),'topology':stats(source)},'units':[]}
claimed=None
zmin,zmax=source.bounds[:,2];remaining=source
for u in sorted(old['units'],key=lambda u:u['id']):
    v=np.array(u['mesh']['v']).reshape(-1,3);f=np.array(u['mesh']['t']).reshape(-1,3)
    poly=unary_union([Polygon(v[tri,:2]) for tri in f if Polygon(v[tri,:2]).area>1e-8])
    # Clean numerical seam slivers below 0.2 mm, not architectural gaps.
    poly=poly.buffer(.0002).buffer(-.0002).simplify(.0001,preserve_topology=True)
    if claimed is not None: poly=poly.difference(claimed)
    claimed=poly if claimed is None else unary_union([claimed,poly])
    polygons=list(poly.geoms) if poly.geom_type=='MultiPolygon' else [poly]
    contours=[]
    for p in polygons:
        if p.area<1e-7:continue
        contours.append(np.array(p.exterior.coords)[:-1])
        contours.extend(np.array(r.coords)[:-1] for r in p.interiors)
    if not contours:continue
    cutter=mf.CrossSection(contours,mf.FillRule.EvenOdd).extrude(zmax-zmin+4).translate([0,0,zmin-2])
    cut=remaining_mf ^ cutter
    assert cut.status()==mf.Error.NoError
    solid=from_mf(cut)
    if solid.is_empty:continue
    assert solid.is_volume,(u['id'],stats(solid))
    remaining_mf=remaining_mf-cutter
    entry={k:val for k,val in u.items() if k!='mesh'};entry.update(mesh=pack(solid),topology=stats(solid));result['units'].append(entry)
    print(u['id'],len(solid.faces),round(solid.volume,3),flush=True)
# Subtract all displayed pieces at once; retain every source region outside legacy masks.
remaining=from_mf(remaining_mf)
if not remaining.is_empty:
    assert remaining.is_volume
    result['units'].append({'id':'R-新增及未分配区域','kind':'remainder','mesh':pack(remaining),'topology':stats(remaining)})
result['meta']['emptyLegacyGroups']=[u['id'] for u in old['units'] if u['id'] not in {p['id'] for p in result['units']}]
result['meta']['sourceVolume']=float(source.volume)
result['meta']['partsVolume']=sum(u['topology']['volume'] for u in result['units'])
assert abs(result['meta']['partsVolume']-source.volume)/source.volume<1e-5
(ROOT/'data/structure-solids.json.gz').write_bytes(gzip.compress(json.dumps(result,separators=(',',':'),ensure_ascii=False).encode(),mtime=0))
print('VERIFIED',len(result['units']),result['meta'],flush=True)
