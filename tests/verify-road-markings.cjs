// Verify actual embedded Rhino road geometry; no browser or modelling files are modified.
const fs = require('node:fs');
const zlib = require('node:zlib');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html','utf8');
const read = (pattern,label) => {
 const m=html.match(pattern);assert(m,'Missing '+label);return m[1];
};
const model=JSON.parse(zlib.gunzipSync(Buffer.from(read(/const MODEL_GZIP='([^']+)'/,'MODEL_GZIP'),'base64')).toString('utf8'));
const design=JSON.parse(read(/const ROAD_DESIGN_V20 = (\{[^\n]+\});/,'road reference'));
const junctions=JSON.parse(read(/const ROAD_JUNCTIONS_V21 = (\[[^\n]+\]);/,'junction seeds'));
const from=html.indexOf('function buildRoadDesign(){');
const to=html.indexOf('\nfunction updateRoadDesignVisibility(){',from);
assert(from!==-1&&to>from,'Missing road-marking renderer');
const source=html.slice(from,to);
class Group {constructor(){this.userData={};this.children=[]}add(x){this.children.push(x)}}
class Geometry {setAttribute(name,attribute){this[name]=attribute}computeVertexNormals(){}}
class Attribute {constructor(array,itemSize){this.array=array;this.itemSize=itemSize}}
class Mesh {constructor(geometry,material){this.geometry=geometry;this.material=material;this.userData={}}}
class Material {constructor(args){this.args=args}}
const THREE={Group,BufferGeometry:Geometry,BufferAttribute:Attribute,Mesh,MeshStandardMaterial:Material,DoubleSide:2};
const scene={add(){}};
function pointInTriangle2D(x,y,a,b,c){
 const d=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
 if(Math.abs(d)<1e-8)return false;
 const u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/d;
 const v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/d;
 return u>=-1e-6&&v>=-1e-6&&u+v<=1+1e-6;
}
const build=new Function('model','ROAD_DESIGN_V20','ROAD_JUNCTIONS_V21','THREE','scene','pointInTriangle2D','updateRoadDesignVisibility',
 'let roadDesignGroup;\n'+source+'\nbuildRoadDesign();return roadDesignGroup;');
const group=build(model,design,junctions,THREE,scene,pointInTriangle2D,()=>{});
const report=group.userData;
const zebra=group.children.find(g=>g.name==='road-v22-zebra');
assert(zebra,'No zebra crossing mesh was generated');
const a=zebra.geometry.position.array;
const bars=a.length/18;
let invalid=0;
for(let k=0;k+17<a.length;k+=18){
 const p=i=>[a[k+i*3],a[k+i*3+2]];
 const length=Math.hypot(p(0)[0]-p(1)[0],p(0)[1]-p(1)[1]);
 const width=Math.hypot(p(1)[0]-p(2)[0],p(1)[1]-p(2)[1]);
 if(length<1.9||width<.35||length<width*2)invalid++;
}
console.log(JSON.stringify({version:report.version,junctions:report.junctions,
 entrances:report.entrances,crossings:report.crossings,unresolved:report.unresolved,
 zebraBars:bars,invalidOrientation:invalid,geometryVertices:model.roads.v.length,geometryFaces:model.roads.t.length},null,2));
assert.equal(report.version,22);
assert(report.entrances>=60,'Unusually few recognized road entrances');
assert(report.crossings>=50,'Most road entries did not produce crossings');
assert.equal(invalid,0,'Crosswalk stripes have incorrect dimensions');
if(report.unresolved.length) {
 console.warn('WARNING: entries requiring visual verification:',JSON.stringify(report.unresolved));
 if(process.env.STRICT_ROAD_QA==='1')process.exitCode=1;
}
