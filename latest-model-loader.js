/* Rhino 8 source-model importer: geometry-first, no synthetic road/structure geometry.
 * The public repository 2.3dm is the authoritative default.
 * Failure is visible rather than silently showing the previous geometry.
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
 // Brep and SubD expose vertices()/faces(), but their faces are NOT MeshFace arrays.
 if(typename==="mesh"){add(g);return found}
 if(typename.includes("subd")){
  if(R.Mesh&&typeof R.Mesh.createFromSubDControlNet==="function"){
   try{add(R.Mesh.createFromSubDControlNet(g))}catch(e){console.warn("SubD control-net conversion failed",e)}
  }
  return found;
 }
 let brep=g;
 if(typeof g.toBrep==="function"){try{brep=g.toBrep(true)||g}catch(e){}}
 if(typeof brep.getMeshes==="function"){
  try{const ms=brep.getMeshes(R.MeshType.Render);if(ms)for(const m of ms)add(m)}catch(e){}
 }
 if(!found.length&&typeof brep.faces==="function"){
  try{
   const faces=brep.faces();
   for(let i=0;i<faces.count;i++){
    const face=faces.get(i);
    if(face&&typeof face.getMesh==="function"){
     const mesh=face.getMesh(R.MeshType.Render);
     if(mesh)add(mesh);
    }
   }
  }catch(e){console.warn("Brep face mesh extraction failed",e)}
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
 // ROAD LINES v31 — the 31 Oct revision adds the road division line work on a
 // layer named Default: 536 curves, all flat on the deck at the road top. They
 // are curves, not surfaces, so the mesh path below never sees them; sample
 // each one into segments here and move it with the same alignment shift.
 const lineParts=[];
 const names={site:0,roads:0,structure:0};
 // Every layer is logged under the name the file gives it, matched or not.
 // Unmatched layers are dropped silently by design, which makes a new layer
 // (buildings, towers) look like a decode failure. The report says otherwise.
 const layerLog=new Map();
 const logFor=n=>{let r=layerLog.get(n);if(!r){r={name:n,objects:0,meshed:0,unmeshed:0,group:null,types:{}};layerLog.set(n,r)}return r};
 for(let i=0;i<objects.count;i++){
  if(i%20===0)onProgress("解析 Rhino 几何 "+(i+1)+" / "+objects.count);
  const ob=objects.get(i),attr=ob.attributes(),geom=ob.geometry();
  const layer=layers.get(attr.layerIndex);
  const name=basename(layer&&layer.name).toLowerCase();
  const log=logFor(name||"(unnamed)");log.objects++;
  {const t=(geom&&geom.constructor&&geom.constructor.name)||"unknown";log.types[t]=(log.types[t]||0)+1}
  if(name==="default"&&geom&&typeof geom.pointAt==="function"&&geom.domain){
   const d=geom.domain,kind=(geom.constructor&&geom.constructor.name)||"";
   const n=kind==="LineCurve"?2:kind==="PolylineCurve"?Math.max(2,geom.pointCount||2):24;
   const pts=[];
   for(let s2=0;s2<n;s2++){
    const p=geom.pointAt(d[0]+(d[1]-d[0])*s2/(n-1));
    if(p)pts.push([Number(p[0]),Number(p[1]),Number(p[2])]);
   }
   // Store the sampled polyline itself. Pushing endpoint PAIRS here shares
   // each interior point between two segments, and the alignment shift below
   // then lands on it twice, throwing the line off the site entirely.
   if(pts.length>1){lineParts.push(pts);log.group="lines";log.meshed++}
   continue;
  }
  const group=/road|道路/.test(name)?"roads":/site|场地/.test(name)?"site":/struct|结构/.test(name)?"structure":null;
  log.group=group;
  if(!group)continue;
  names[group]++;
  const pieces=getMeshes(geom,R);
  if(!pieces.length){log.unmeshed++;unresolved.push({layer:name,type:geom.constructor&&geom.constructor.name||"unknown",index:i});continue}
  log.meshed++;
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
 // ALIGNMENT v27 — move the source into the application's site frame.
 // Rhino vertices arrive in world coordinates (this file: X -621.4…3.6,
 // Y -0.7…373.9, Z -1.4…23.6). The application model is site-centred: XY
 // centre at the origin and the site top surface at z = 0. Imported geometry
 // used to be handed over untransformed, so Site and Roads rendered roughly
 // 360 m away from the structures, parcels, water and landscaping.
 // The shift is derived from the imported site's own bounding box rather than
 // hard-coded, so a re-export from a different world position still lands
 // correctly. Site, Roads and Structure share ONE shift — never compute it per
 // layer, or the layers separate from each other.
 // This is a rigid translation: no rotation, no scaling, no vertex is edited.
 const siteProbe=newMesh();siteParts.forEach(p=>append(siteProbe,p));
 const probe=meshInfo(siteProbe);
 const shift=[-(probe.min[0]+probe.max[0])/2,-(probe.min[1]+probe.max[1])/2,-probe.max[2]];
 const translate=m=>{for(let i=0;i<m.v.length;i+=3){m.v[i]+=shift[0];m.v[i+1]+=shift[1];m.v[i+2]+=shift[2]}};
 for(const p of siteParts)translate(p);
 for(const p of roadParts)translate(p);
 for(const p of structureParts)translate(p);
 for(const curve of lineParts)for(const q of curve){q[0]+=shift[0];q[1]+=shift[1];q[2]+=shift[2]}
 // Rhino world coordinates stay recoverable: world = local + origin.
 const origin=[-shift[0],-shift[1],-shift[2]];
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
 const layerSummary=[...layerLog.values()].sort((a,b)=>b.objects-a.objects);
 // Classify the line work so the app can draw it at a believable weight.
 // A zebra rung is a short straight curve with other short straight curves
 // running PARALLEL BESIDE it; a dash of a lane line is short and straight
 // too, but its neighbours sit end to end along its own direction. Without
 // that distinction a dashed centre line renders as a row of fat blocks.
 const info=lineParts.map(c=>{
  const a=c[0],b=c[c.length-1];
  let len=0;for(let i=0;i+1<c.length;i++)len+=Math.hypot(c[i+1][0]-c[i][0],c[i+1][1]-c[i][1]);
  const chord=Math.hypot(b[0]-a[0],b[1]-a[1]);
  const dir=chord>1e-6?[(b[0]-a[0])/chord,(b[1]-a[1])/chord]:[1,0];
  return {len,straight:len>0&&chord/len>.985,dir,mid:[(a[0]+b[0])/2,(a[1]+b[1])/2]};
 });
 for(let i=0;i<info.length;i++){
  const f=info[i];
  f.bold=false;
  if(!f.straight||f.len>9||f.len<1)continue;
  let beside=0;
  for(let j=0;j<info.length&&beside<2;j++){
   if(j===i)continue;const g=info[j];
   if(!g.straight||g.len>9||g.len<1)continue;
   const dx=g.mid[0]-f.mid[0],dy=g.mid[1]-f.mid[1],d=Math.hypot(dx,dy);
   if(d<.3||d>12)continue;
   if(Math.abs(f.dir[0]*g.dir[0]+f.dir[1]*g.dir[1])<.95)continue;
   const along=Math.abs(dx*f.dir[0]+dy*f.dir[1]),across=Math.abs(-dx*f.dir[1]+dy*f.dir[0]);
   if(across>along)beside++;              // sits beside, not end to end
  }
  f.bold=beside>=2;
 }
 const lines={v:[],w:[]};
 lineParts.forEach((curve,ci)=>{
  const w=info[ci].bold?.55:.16;
  for(let i=0;i+1<curve.length;i++){
   lines.v.push(curve[i][0],curve[i][1],curve[i][2],curve[i+1][0],curve[i+1][1],curve[i+1][2]);
   lines.w.push(w);
  }
 });
 const m={site,roads,lines,parcels,units,meta:{
  source:file.name+" · Rhino source layers · "+new Date().toISOString().slice(0,10),
  modelName:file.name,imported:true,topologyVerified:false,
  origin,alignedToSiteFrame:true,roadLineSegments:lines.v.length/6,
  roadLineBold:lines.w.filter(w=>w>.3).length,
  warnings:["地块为独立场地组件的边界近似，尚未完成道路减场地布尔运算","跨路关系按几何距离初判；非施工拆分方案",...unresolved.slice(0,10).map(x=>"Unmeshed: "+x.layer+" / "+x.type)],
  layers:layerSummary,
  siteArea:siteGeo.projection||siteGeo.area,roadArea:roadGeo.projection||roadGeo.area,
  sourceArea:totalArea,areaError:0,counts
 }};
 return m;
}
// Public GitHub Pages source is authoritative. Local IndexedDB uploads are not
// used, so every visitor sees the same verified repository asset.
const PUBLISHED_SOURCE="./2.3dm";
let publishedTask=null;
// The import dialog stays off for ordinary visitors, so everyone still sees the
// same verified repository asset. ?import=1 opens it for whoever asked for it;
// the upload lives in that one browser's IndexedDB and reaches nobody else.
const IMPORT_MODE=/[?&]import=1(?:&|$)/.test(location.search);
let activeMeta=null;
function setStatus(text){const el=document.getElementById("loadText");if(el)el.textContent=text}
async function readUpload(){
 if(!IMPORT_MODE)return null;
 let saved=null;
 try{saved=await database("get")}catch(e){console.warn("Local upload store unreadable",e);return null}
 if(!saved||!saved.bytes||saved.bytes.byteLength<10240)return null;
 const file=new File([saved.bytes],saved.name||"uploaded.3dm",{type:"application/octet-stream"});
 const parsed=await parseFile(file,setStatus);
 parsed.meta.source=(saved.name||"uploaded.3dm")+" \u00b7 \u672c\u5730\u4e0a\u4f20\uff08\u4ec5\u672c\u6d4f\u89c8\u5668\uff09";
 parsed.meta.localUpload=true;
 return parsed;
}
async function getSavedModel(){
 if(publishedTask)return publishedTask;
 publishedTask=(async()=>{
  if(IMPORT_MODE){
   try{
    const mine=await readUpload();
    if(mine){activeMeta=mine.meta;return mine}
   }catch(e){
    // A bad upload must never strand the page on a blank screen.
    console.error("Local upload failed to parse; falling back to the published source",e);
    window.__importError=e.message||String(e);
   }
  }
  const response=await fetch(PUBLISHED_SOURCE,{cache:"no-cache"});
  if(!response.ok){
   if(response.status!==404)console.warn("Published Rhino source HTTP",response.status);
   throw Error("Published Rhino source unavailable: HTTP "+response.status);
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
  activeMeta=parsed.meta;
  return parsed;
 })().catch(error=>{
  console.error("Published 2.3dm failed validation",error);
  throw error;
 });
 return publishedTask;
}

function esc(t){return String(t).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))}
function reportHTML(meta){
 const rows=(meta&&meta.layers)||[];
 if(!rows.length)return '<div style="color:#9aa1ab">没有图层信息</div>';
 const GROUP={site:["场地","#8cb359"],roads:["道路","#4aa3e0"],structure:["结构","#e9ecf0"],lines:["划线","#d9c79a"]};
 return '<table style="border-collapse:collapse;width:100%;font-size:11px">'+rows.map(r=>{
  const g=GROUP[r.group]||null;
  const tag=g?'<span style="color:'+g[1]+'">'+g[0]+'</span>'
            :'<span style="color:#e08a3c">未接入</span>';
  const warn=r.unmeshed?'<span style="color:#e05a4a"> ⚠ '+r.unmeshed+' 无网格</span>':'';
  return '<tr><td style="padding:3px 8px 3px 0;color:#e9ecf0">'+esc(r.name)+'</td>'
   +'<td style="padding:3px 8px 3px 0;white-space:nowrap">'+tag+'</td>'
   +'<td style="padding:3px 8px 3px 0;text-align:right;color:#9aa1ab">'+r.objects+'</td>'
   +'<td style="padding:3px 0;color:#7e848d">'+esc(Object.keys(r.types).join("/"))+warn+'</td></tr>';
 }).join('')+'</table>';
}
function controls(){
 if(!IMPORT_MODE)return;
 const box=document.createElement("div");
 box.id="rhinoImportPanel";
 box.style.cssText="position:fixed;left:16px;bottom:16px;z-index:60;width:460px;max-width:calc(100vw - 32px);"
  +"max-height:62vh;overflow:auto;background:#16181cf2;border:.5px solid #3a3f47;border-radius:14px;"
  +"padding:13px 15px;font:12px -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;color:#e9ecf0;"
  +"-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);"
  +"box-shadow:0 8px 32px rgba(0,0,0,.5)";
 const src=(activeMeta&&activeMeta.source)||"未知";
 const local=!!(activeMeta&&activeMeta.localUpload);
 box.innerHTML=
  '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:9px">'
  +'<strong style="font-size:13px">Rhino 模型导入</strong>'
  +'<button id="riClose" style="border:0;background:transparent;color:#9aa1ab;cursor:pointer;font-size:16px;line-height:1">×</button></div>'
  +'<div style="font-size:11px;color:'+(local?"#ffd98a":"#9aa1ab")+';margin-bottom:10px">当前源：'+esc(src)+'</div>'
  +'<input type="file" id="riFile" accept=".3dm" style="width:100%;font-size:11px;color:#c8ced7;margin-bottom:9px">'
  +'<div id="riMsg" style="font-size:11px;color:#9aa1ab;margin-bottom:9px;line-height:1.7">'
  +'选一个 .3dm。解析后会先列出文件里的所有图层，确认无误再应用。</div>'
  +'<div id="riReport" style="margin-bottom:10px"></div>'
  +'<div style="display:flex;gap:7px">'
  +'<button id="riApply" disabled style="flex:1;padding:8px;border:0;border-radius:8px;background:#0a84ff;color:#fff;cursor:pointer;opacity:.4">应用并重载</button>'
  +'<button id="riExport" disabled style="flex:1;padding:8px;border:.5px solid #0a84ff;border-radius:8px;background:transparent;color:#6cb6ff;cursor:pointer;opacity:.4">导出解析结果</button>'
  +'<button id="riReset" style="padding:8px 12px;border:.5px solid #3a3f47;border-radius:8px;background:transparent;color:#c8ced7;cursor:pointer">恢复发布版</button>'
  +'</div>';
 document.body.appendChild(box);
 const msg=box.querySelector("#riMsg"),report=box.querySelector("#riReport"),apply=box.querySelector("#riApply"),xport=box.querySelector("#riExport");
 if(activeMeta)report.innerHTML=reportHTML(activeMeta);
 if(window.__importError)msg.innerHTML='<span style="color:#e05a4a">上次上传解析失败，已回退到发布版：'+esc(window.__importError)+'</span>';
 box.querySelector("#riClose").onclick=()=>box.remove();
 let pending=null,pendingParsed=null;
 box.querySelector("#riFile").onchange=async e=>{
  const file=e.target.files&&e.target.files[0];if(!file)return;
  pending=null;pendingParsed=null;apply.disabled=true;apply.style.opacity=".4";
  xport.disabled=true;xport.style.opacity=".4";report.innerHTML="";
  msg.textContent="解析中…";
  try{
   const bytes=await file.arrayBuffer();
   const parsed=await parseFile(new File([bytes],file.name),t=>{msg.textContent=t});
   pending={name:file.name,bytes};pendingParsed=parsed;
   report.innerHTML=reportHTML(parsed.meta);
   const c=parsed.meta.counts||{};
   msg.innerHTML='解析成功：场地 '+(c.site|0)+' · 道路 '+(c.road|0)+' · 结构 '+(c.structure|0)
    +(c.unresolved?' · <span style="color:#e05a4a">无网格 '+c.unresolved+'</span>':'')
    +'<br><span style="color:#7e848d">标为「未接入」的图层现在会被丢弃；把这份报告给我，我按它们的真实名字接入。</span>';
   apply.disabled=false;apply.style.opacity="1";
   xport.disabled=false;xport.style.opacity="1";
  }catch(err){
   msg.innerHTML='<span style="color:#e05a4a">解析失败：'+esc(err.message||err)+'</span>';
  }
 };
 // The build container cannot install rhino3dm -- npm, pypi and the CDNs are all
 // blocked -- so the decode has to happen in a browser that can reach them. This
 // hands the decoded model back so it can be baked without the .3dm ever having
 // to fit under GitHub's 100MB per-file limit.
 xport.onclick=async()=>{
  if(!pendingParsed)return;
  xport.disabled=true;msg.textContent="序列化中…";
  try{
   // millimetre precision is ample here and roughly halves the payload
   const json=JSON.stringify(pendingParsed,(k,v)=>
     ArrayBuffer.isView(v)?Array.from(v):typeof v==="number"?Math.round(v*1000)/1000:v);
   const raw=new Blob([json]).size;
   let blob,ext;
   if(typeof CompressionStream==="function"){
    blob=await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream("gzip"))).blob();
    ext=".json.gz";
   }else{blob=new Blob([json],{type:"application/json"});ext=".json"}
   const a=document.createElement("a");
   a.href=URL.createObjectURL(blob);
   a.download=((pending&&pending.name)||"model").replace(/\.3dm$/i,"")+"-parsed"+ext;
   document.body.appendChild(a);a.click();a.remove();
   setTimeout(()=>URL.revokeObjectURL(a.href),30000);
   const mb=n=>(n/1048576).toFixed(1)+" MB";
   msg.innerHTML="导出完成："+esc(a.download)+"<br>"
    +'<span style="color:#7e848d">JSON '+mb(raw)+" → 压缩后 "+mb(blob.size)
    +"。把这个文件发给我，3dm 不用传 GitHub。</span>";
  }catch(err){
   msg.innerHTML='<span style="color:#e05a4a">导出失败：'+esc(err.message||err)+'</span>';
  }
  xport.disabled=false;
 };
 apply.onclick=async()=>{
  if(!pending)return;
  apply.disabled=true;msg.textContent="保存中…";
  try{await database("put",{name:pending.name,bytes:pending.bytes,savedAt:Date.now()});location.reload()}
  catch(err){msg.innerHTML='<span style="color:#e05a4a">保存失败：'+esc(err.message||err)+'</span>';apply.disabled=false}
 };
 box.querySelector("#riReset").onclick=async()=>{
  try{await database("delete")}catch(e){}
  location.reload();
 };
}
window.latestModelBridge={getSavedModel,controls,parseFile};
})();