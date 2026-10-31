/* Rhino 8 source-model importer: geometry-first, no synthetic road/structure geometry.
 * A user-selected source is stored in this browser's IndexedDB; the original
 * published model remains the fallback until a verified import succeeds.
 */
(function(){
"use strict";
const DB="form-assembly-rhino-v1", STORE="models", KEY="active";
const CDN="https://cdn.jsdelivr.net/npm/rhino3dm@8.35.0/rhino3dm.min.js";
const WASM="https://cdn.jsdelivr.net/npm/rhino3dm@8.35.0/rhino3dm.wasm";
function openDB(){
 return new Promise((resolve,reject)=>{
  if(!window.indexedDB){reject(Error("This browser does not support IndexedDB"));return}
  const r=indexedDB.open(DB,1);
  r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains(STORE))r.result.createObjectStore(STORE)};
  r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
 });
}
async function database(op,value){
 const db=await openDB();
 return new Promise((resolve,reject)=>{
  const tx=db.transaction(STORE,op==="get"?"readonly":"readwrite");
  const store=tx.objectStore(STORE);
  const r=op==="get"?store.get(KEY):op==="delete"?store.delete(KEY):store.put(value,KEY);
  r.onsuccess=()=>resolve(r.result);
  r.onerror=()=>reject(r.error);
  tx.oncomplete=()=>db.close();
 });
}
function xhrScript(src){
 return new Promise((resolve,reject)=>{
  if(window.rhino3dm){resolve();return}
  const tag=document.createElement("script");tag.src=src;tag.crossOrigin="anonymous";
  tag.onload=resolve;tag.onerror=()=>reject(Error("无法下载 Rhino 8 解码器；请检查网络连接"));
  document.head.appendChild(tag);
 });
}
let rhinoTask;
async function getRhino(){
 if(!rhinoTask)rhinoTask=(async()=>{
  await xhrScript(CDN);
  return await window.rhino3dm({locateFile:()=>WASM});
 })();
 return rhinoTask;
}
function append(target,source){
 if(!source||!source.v.length||!source.t.length)return;
 const base=target.v.length/3;
 for(let i=0;i<source.v.length;i++)target.v.push(source.v[i]);
 for(let i=0;i<source.t.length;i++)target.t.push(base+source.t[i]);
}
function newMesh(){return {v:[],t:[]}}
function makeMesh(g){
 if(!g||typeof g.vertices!=="function"||typeof g.faces!=="function")return null;
 const verts=g.vertices(),faces=g.faces(),v=[],t=[];
 const nv=verts.count,nf=faces.count;
 if(!(nv>2&&nf>0))return null;
 for(let i=0;i<nv;i++){const p=verts.get(i);v.push(Number(p[0]),Number(p[1]),Number(p[2]))}
 for(let i=0;i<nf;i++){
  const f=faces.get(i);const a=Number(f[0]),b=Number(f[1]),c=Number(f[2]),d=Number(f[3]);
  if([a,b,c].some(n=>!Number.isInteger(n)||n<0||n>=nv))continue;
  t.push(a,b,c);
  if(Number.isInteger(d)&&d>=0&&d<nv&&d!==c&&d!==a)t.push(a,c,d);
 }
 return t.length?{v,t}:null;
}
function getMeshes(g,R){
 const found=[];
 const add=m=>{const x=makeMesh(m);if(x)found.push(x)};
 if(!g)return found;
 const typename=(g.constructor&&g.constructor.name||"").toLowerCase();
 if(typename==="mesh"||typeof g.vertices==="function"&&typeof g.faces==="function"){add(g);return found}
 // Rhino caches render meshes on Brep faces; do not generate approximate boxes.
 let brep=g;
 if(typeof g.toBrep==="function"){try{brep=g.toBrep(true)||g}catch(e){}}
 if(typeof brep.getMeshes==="function"){
  try{const ms=brep.getMeshes(R.MeshType.Render);if(ms)for(const m of ms)add(m)}catch(e){}
 }
 if(!found.length&&typeof brep.faces==="function"){
  try{
   const faces=brep.faces();for(let i=0;i<faces.count;i++){
    const face=faces.get(i);
    if(typeof face.getMesh==="function")add(face.getMesh(R.MeshType.Render));
   }
  }catch(e){}
 }
 if(!found.length&&typename.includes("subd")&&R.Mesh.createFromSubDControlNet){
  try{add(R.Mesh.createFromSubDControlNet(g))}catch(e){}
 }
 return found;
}
function area2(poly){let v=0;for(let i=0;i<poly.length;i++){const a=poly[i],b=poly[(i+1)%poly.length];v+=a[0]*b[1]-b[0]*a[1]}return v/2}
function hull(points){
 const keys=new Map();
 for(const p of points)keys.set(p[0].toFixed(3)+","+p[1].toFixed(3),p);
 const s=[...keys.values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
 if(s.length<3)return s;
 const c=(a,b,d)=>(b[0]-a[0])*(d[1]-a[1])-(b[1]-a[1])*(d[0]-a[0]);
 const lo=[],hi=[];for(const p of s){while(lo.length>1&&c(lo[lo.length-2],lo[lo.length-1],p)<=0)lo.pop();lo.push(p)}
 for(let i=s.length-1;i>=0;i--){const p=s[i];while(hi.length>1&&c(hi[hi.length-2],hi[hi.length-1],p)<=0)hi.pop();hi.push(p)}
 lo.pop();hi.pop();return lo.concat(hi);
}
function meshInfo(m){
 const v=m.v;
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<v.length;i+=3){for(let j=0;j<3;j++){const q=v[i+j];if(q<min[j])min[j]=q;if(q>max[j])max[j]=q}}
 let surface=0,projection=0;
 for(let i=0;i<m.t.length;i+=3){
  const ia=m.t[i]*3,ib=m.t[i+1]*3,ic=m.t[i+2]*3;
  const a=[v[ia],v[ia+1],v[ia+2]],b=[v[ib],v[ib+1],v[ib+2]],c=[v[ic],v[ic+1],v[ic+2]];
  const x=(b[1]-a[1])*(c[2]-a[2])-(b[2]-a[2])*(c[1]-a[1]);
  const y=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
  const z=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  surface+=Math.hypot(x,y,z)*.5;
  // Top surface only; do not double-count underside or vertical facades.
  if(z>0&&Math.abs(z)>Math.hypot(x,y)*.3)projection+=z*.5;
 }
 return {min,max,center:min.map((n,i)=>(n+max[i])/2),size:min.map((n,i)=>max[i]-n),area:surface,projection};
}
function inPolygon(pt,poly){let yes=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
 const a=poly[i],b=poly[j];if((a[1]>pt[1])!==(b[1]>pt[1])&&pt[0]<(b[0]-a[0])*(pt[1]-a[1])/(b[1]-a[1])+a[0])yes=!yes;
}return yes}
function dist(pt,p){const dx=pt[0]-p.center[0],dy=pt[1]-p.center[1];return Math.hypot(dx,dy)}
function polygonBoundary(m){
 // For every horizontal visible top triangle, count its 2D perimeter
 // edges. Reject external overlaps when possible; convex hull fallback is
 // labelled unverified in reports rather than misrepresented as a Boolean cut.
 const edgeMap=new Map(),V=m.v,T=m.t;
 const p=i=>[V[i*3],V[i*3+1]];
 const k=a=>a.map(x=>Math.round(x*1000)).join(":");
 for(let i=0;i<T.length;i+=3){
  const a=T[i],b=T[i+1],c=T[i+2],ax=V[a*3],ay=V[a*3+1],bx=V[b*3],by=V[b*3+1],cx=V[c*3],cy=V[c*3+1];
  const signed=(bx-ax)*(cy-ay)-(by-ay)*(cx-ax);
  if(signed<0.005)continue;
  for(const [u,v] of [[a,b],[b,c],[c,a]]){const P=p(u),Q=p(v),kp=k(P),kq=k(Q),id=kp<kq?kp+"|"+kq:kq+"|"+kp;
   const entry=edgeMap.get(id)||{count:0,p:P,q:Q};entry.count++;edgeMap.set(id,entry)}
 }
 const edges=[...edgeMap.values()].filter(e=>e.count===1);
 const points=[];for(const e of edges){points.push(e.p,e.q)}
 if(points.length<3){for(let i=0;i<V.length;i+=3)points.push([V[i],V[i+1]])}
 // Exact non-convex tracing is not guaranteed by all Rhino mesh edge formats.
 return hull(points);
}
function basename(name){return (name||"").trim()}
async function parseFile(file,onProgress){
 const R=await getRhino();
 const bytes=new Uint8Array(await file.arrayBuffer());
 const doc=R.File3dm.fromByteArray(bytes);
 if(!doc)throw Error("Rhino 3DM could not be decoded");
 const objects=doc.objects(),layers=doc.layers();
 const siteParts=[],roadParts=[],structureParts=[],unresolved=[];
 const names={site:0,roads:0,structure:0};
 for(let i=0;i<objects.count;i++){
  if(i%20===0)onProgress("解析 Rhino 几何 "+(i+1)+" / "+objects.count);
  const ob=objects.get(i),attr=ob.attributes(),geom=ob.geometry();
  const layer=layers.get(attr.layerIndex);
  const name=basename(layer&&layer.name).toLowerCase();
  const group=/road|道路/.test(name)?"roads":/site|场地/.test(name)?"site":/struct|结构/.test(name)?"structure":null;
  if(!group)continue;
  names[group]++;
  const pieces=getMeshes(geom,R);
  if(!pieces.length){unresolved.push({layer:name,type:geom.constructor&&geom.constructor.name||"unknown",index:i});continue}
  const merged=newMesh();
  for(const mesh of pieces)append(merged,mesh);
  if(group==="roads")roadParts.push(merged);
  else if(group==="site")siteParts.push(merged);
  else structureParts.push(merged);
 }
 if(!siteParts.length||!roadParts.length)throw Error("缺少可读取的场地/道路网格。请在 Rhino 中先为曲面生成渲染网格，再重新保存 3DM。");
 if(unresolved.some(u=>/road|道路|site|场地/.test(u.layer)))throw Error("部分场地或道路曲面没有可读取的网格；为防止错误替换，已取消导入。请先在 Rhino 中导出 Mesh。");
 if(names.structure>0&&unresolved.some(u=>/struct|结构/.test(u.layer)))throw Error("结构图层有未成功转换的 SubD/Brep。为避免丢失结构，已取消导入；请在 Rhino 中生成并保存渲染网格。");
 if(names.structure>0&&!structureParts.length)throw Error("结构图层无法读取真实网格；导入已取消。");
 // Keep every source vertex in its original coordinates.
 const site=newMesh(),roads=newMesh();
 siteParts.forEach(p=>append(site,p));roadParts.forEach(p=>append(roads,p));
 const parcels=[];
 for(const mesh of siteParts){
  const geo=meshInfo(mesh),boundary=polygonBoundary(mesh);
  if(boundary.length<3||Math.abs(area2(boundary))<1)continue;
  const id="P-"+String(parcels.length+1).padStart(2,"0");
  const per=boundary.reduce((sum,p,i)=>sum+Math.hypot(p[0]-boundary[(i+1)%boundary.length][0],p[1]-boundary[(i+1)%boundary.length][1]),0);
  parcels.push({id,boundary,area:Math.abs(area2(boundary)),perimeter:per,type:"Rhino 场地组件（边界待校核）",unit:null,center:geo.center});
 }
 if(!parcels.length)throw Error("无法识别场地平面边界，导入被取消。");
 const units=[];let totalArea=0;
 for(const mesh of structureParts){
  const geo=meshInfo(mesh),center=geo.center,rank=parcels.map((p,i)=>({i,d:dist(center,p)})).sort((a,b)=>a.d-b.d);
  const inside=parcels.findIndex(p=>inPolygon(center,p.boundary));
  const isLink=inside<0&&rank.length>1&&rank[0].d<45&&rank[1].d<45;
  const idx=inside>=0?inside:rank.length?rank[0].i:null;
  const kind=isLink?"connection":idx==null?"edge":"parcel";
  const id=(kind==="connection"?"C-":kind==="edge"?"E-":"S-")+String(units.length+1).padStart(2,"0");
  const adjacent=isLink?rank.slice(0,2).map(x=>x.i):idx!=null?[idx]:[];
  const parent=idx!=null?parcels[idx].id:null;
  units.push({id,kind,parcel:idx,parent,adjacent,mesh,center,size:geo.size,minZ:geo.min[2],maxZ:geo.max[2],area:geo.area});
  totalArea+=geo.area;
  if(kind==="parcel"&&idx!=null)parcels[idx].unit=id;
 }
 const siteGeo=meshInfo(site),roadGeo=meshInfo(roads);
 const counts={site:siteParts.length,road:roadParts.length,structure:structureParts.length,unresolved:unresolved.length,originalObjects:objects.count};
 const m={site,roads,parcels,units,meta:{
  source:file.name+" · Rhino source layers · "+new Date().toISOString().slice(0,10),
  modelName:file.name,imported:true,topologyVerified:false,
  warnings:["地块为独立场地组件的边界近似，尚未完成道路减场地布尔运算","跨路关系按几何距离初判；非施工拆分方案",...unresolved.slice(0,10).map(x=>"Unmeshed: "+x.layer+" / "+x.type)],
  siteArea:siteGeo.projection||siteGeo.area,roadArea:roadGeo.projection||roadGeo.area,
  sourceArea:totalArea,areaError:0,counts
 }};
 return m;
}
// Public GitHub Pages source is authoritative. Local IndexedDB uploads are not
// used, so every visitor sees the same verified repository asset.
const PUBLISHED_SOURCE="./2.3dm";
let publishedTask=null;
function controls(){ /* Public presentation: no import or restore dialog. */ }
async function getSavedModel(){
 if(publishedTask)return publishedTask;
 publishedTask=(async()=>{
  const response=await fetch(PUBLISHED_SOURCE,{cache:"no-cache"});
  if(!response.ok){
   if(response.status!==404)console.warn("Published Rhino source HTTP",response.status);
   return null; // Preserve existing embedded model until source binary is published.
  }
  const blob=await response.blob();
  if(blob.size<10240)throw Error("Published Rhino 3DM seems incomplete");
  const source=new File([blob],"2.3dm",{type:"application/octet-stream"});
  const parsed=await parseFile(source,status=>{
   const label=document.getElementById("loadText");
   if(label)label.textContent=status;
  });
  parsed.meta.source="2.3dm · GitHub Pages public default";
  parsed.meta.publishedDefault=true;
  return parsed;
 })().catch(error=>{
  console.error("Could not use published 2.3dm; keeping legacy embedded scene",error);
  return null;
 });
 return publishedTask;
}
window.latestModelBridge={getSavedModel,controls,parseFile};
})();