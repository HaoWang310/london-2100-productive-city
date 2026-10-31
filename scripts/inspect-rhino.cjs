'use strict';
// Diagnostic only: introspect the exact Rhino binary published on GitHub Pages.
const fs=require('node:fs');
const factory=require('rhino3dm');
async function run(){
 const R=await factory();
 const bytes=new Uint8Array(fs.readFileSync('2.3dm'));
 const doc=R.File3dm.fromByteArray(bytes);
 if(!doc)throw Error('File3dm decode failed');
 const layers=doc.layers(),objects=doc.objects();
 console.log('RHINO_FILE',JSON.stringify({bytes:bytes.length,layerCount:layers.count,objectCount:objects.count}));
 const summary=new Map(),failures=[],sample=[];
 for(let i=0;i<objects.count;i++){
  const o=objects.get(i),a=o.attributes(),g=o.geometry();
  const li=a.layerIndex, L=layers.get(li);
  const layer=L&&L.name||'(unnamed)';
  const type=g.constructor?.name||'(unknown)';
  const key=li+' '+layer;
  let s=summary.get(key);
  if(!s){s={layerIndex:li,name:layer,total:0,types:{},readable:0,unreadable:0,samples:[]};summary.set(key,s)}
  s.total++;s.types[type]=(s.types[type]||0)+1;
  const isMesh=typeof g.vertices==='function'&&typeof g.faces==='function';
  let vertices=-1,faces=-1,renderMeshes=0,err='';
  try{
   if(isMesh){vertices=g.vertices().count;faces=g.faces().count}
   else if(typeof g.getMeshes==='function'){
    const ms=g.getMeshes(R.MeshType.Render);
    renderMeshes=ms?.length||0;
   }
   else if(typeof g.faces==='function'){
    const fc=g.faces();const f=fc?.count?fc.get(0):null;
    if(f&&typeof f.getMesh==='function'){const m=f.getMesh(R.MeshType.Render);renderMeshes=m?1:0}
   }
  }catch(e){err=String(e).slice(0,160)}
  if((vertices>2&&faces>0)||renderMeshes>0)s.readable++;else s.unreadable++;
  if(s.samples.length<3)s.samples.push({type,isMesh,vertices,faces,renderMeshes,err,layerIndex:li});
  if(i<15)sample.push({i,layer,type,vertices,faces,renderMeshes,err});
  if(err&&failures.length<10)failures.push({i,layer,type,err});
 }
 console.log('LAYERS',JSON.stringify([...summary.values()].sort((a,b)=>b.total-a.total).slice(0,100)));
 console.log('FIRST_OBJECTS',JSON.stringify(sample));
 console.log('MESH_ERRORS',JSON.stringify(failures));
 const html=fs.readFileSync('index.html','utf8');
 const target='getSavedModel';
 console.log('APP_HOOK',JSON.stringify({loaderTag:(html.match(/.{0,100}latest-model-loader.js.{0,140}/g)||[]).slice(0,3),hookCount:(html.match(/getSavedModel/g)||[]).length,hookFragments:(html.match(/.{0,180}getSavedModel.{0,240}/g)||[]).slice(0,6),size:html.length}));
}
run().catch(e=>{console.error('AUDIT_FAILED',e.stack||e);process.exit(1)});
