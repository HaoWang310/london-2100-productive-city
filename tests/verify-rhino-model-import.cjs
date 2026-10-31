// Public Rhino 8 model replacement regression checks; run using Node 20+.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync('index.html', 'utf8');
const importer = fs.readFileSync('latest-model-loader.js', 'utf8');
new vm.Script(importer, {filename: 'latest-model-loader.js'});
const anchor = "<script>'use strict';";
const ix = html.lastIndexOf(anchor);
assert(ix >= 0, 'App application script is missing');
const end = html.indexOf('</script>', ix);
assert(end > ix, 'App script closing tag is missing');
new vm.Script(html.slice(ix + 8, end), {filename: 'app-main.js'});
assert(html.includes('src="./latest-model-loader.js?v='), 'Rhino source loader not included');
// The loader is cached per query string, so returning visitors keep running the
// previous file until this token changes. Bump it in the same commit as any
// latest-model-loader.js change, or the deployed fix never reaches them.
assert(html.includes('src="./latest-model-loader.js?v=20261031-road-lines-v31b"'), 'Loader cache-busting token was not bumped for the road-line change');
assert(!html.includes('v=20261031-source-road-replace-v1'), 'Stale loader cache token is still referenced');
assert(importer.includes('const PUBLISHED_SOURCE="./2.3dm";'), 'Default source must match the published 2.3dm asset');
assert(!importer.includes('2(2).3dm'), 'Stale source filename remains');
assert(importer.includes('fetch(PUBLISHED_SOURCE,{cache:"no-cache"})'), 'Default source must be revalidated on refresh');
assert(importer.includes('new File([blob],"2.3dm"'), 'Imported source provenance is incorrect');
assert(importer.includes('File3dm.fromByteArray'), 'Actual Rhino 3DM decoding is required');
assert(importer.includes('modelName:file.name'), 'Missing source provenance');
assert(importer.includes('topologyVerified:false'), 'Unverified topology must be labelled');
assert(importer.includes('names.structure>0&&unresolved.some'), 'Incomplete structures must be rejected');
assert(importer.includes('if(!siteParts.length||!roadParts.length)'), 'Incomplete site or road meshes must be rejected');
assert(importer.includes('throw Error("Published Rhino source unavailable: HTTP "+response.status)'), 'Missing source must produce visible failure rather than stale model fallback');
assert(importer.includes('window.latestModelBridge={getSavedModel,controls,parseFile}'), 'Public loader bridge is missing');
assert(!importer.includes('database("set",m)'), 'Local IndexedDB model must not override public source');
// Dual Site/Roads replacement must NOT overwrite the original structures,
// parcels, landscape, hydrology or assembly datasets.
assert(html.includes('let siteDisplayOverride=null, roadsDisplayOverride=null, roadLineOverride=null;'), 'Independent Site/Roads/line override state is missing');
assert(html.includes("siteMesh=new THREE.Mesh(bufferGeom(siteDisplayOverride||model.site)"), 'Site view does not use the published mesh');
assert(html.includes('siteDisplayOverride=importedModel.site;'), 'Published Site mesh is not applied');
assert(html.includes('roadsDisplayOverride=importedModel.roads;'), 'Published Roads mesh is not applied');
assert(html.includes('model.roads=roadsDisplayOverride;'), 'Embedded Roads geometry is not replaced');
assert(html.includes('roadSource=\'2.3dm / Roads\''), 'Roads provenance is missing');
assert(html.includes('if(roadsDisplayOverride){'), 'Old roads annotations are not guarded');
assert(html.includes("roadDesignConfig.enabled=false;vehicleConfig.enabled=false;"), 'Outdated road markings/vehicle locations were not disabled');
assert(html.includes('model=JSON.parse(await new Response(stream).text());'), 'Embedded complete scene must remain loaded');
assert(html.includes('lowModel=JSON.parse('), 'Original structure LOD must remain available');
assert(!html.includes('if(importedModel){model=importedModel;lowModel=null}'), 'Published source must not replace the whole model');
assert(html.includes('}else{buildRoadDesign();buildRoadVehicles();}'), 'Original road marking/vehicle code removed');
assert(html.includes('}else{buildContextDecorations();buildWaterLayer();}'), 'Original greenery/water functions removed');
assert(html.includes('function isolate(){'), 'Original standalone structure viewing was removed');
assert(html.includes("state.targetExplode=mode==='explode'?.45:0"), 'Original explode control was removed');
// ALIGNMENT v27 — imported Site/Roads/Structure must be moved into the
// application's site-centred frame, or they render ~360 m away from the
// retained structures, parcels, water and landscaping.
assert(!importer.includes('// Keep every source vertex in its original coordinates.'), 'Imported geometry must be aligned to the site frame, not left in Rhino world coordinates');
assert(importer.includes('const shift=[-(probe.min[0]+probe.max[0])/2,-(probe.min[1]+probe.max[1])/2,-probe.max[2]];'), 'Site-frame shift must be derived from the imported site bounding box');
assert(importer.includes('for(const p of siteParts)translate(p);'), 'Imported site is not translated into the site frame');
assert(importer.includes('for(const p of roadParts)translate(p);'), 'Imported roads are not translated into the site frame');
assert(importer.includes('for(const p of structureParts)translate(p);'), 'Imported structures are not translated into the site frame');
assert(importer.includes('const origin=[-shift[0],-shift[1],-shift[2]];'), 'Rhino world coordinates must stay recoverable through meta.origin');
assert(importer.includes('origin,alignedToSiteFrame:true,'), 'Imported metadata must publish the alignment origin and flag');
assert(html.includes("if(!importedModel.meta?.alignedToSiteFrame)"), 'Application must reject an unaligned import rather than drawing it offset');
assert(html.includes('drift>1'), 'Application must warn when the 3DM world placement diverges from the embedded model');
// ROAD VEHICLES v27 — traffic must be solved from the live road mesh, never
// restored from the v17 table that was fitted to the previous road geometry.
assert(html.includes('function solveRoadVehiclePositions(limit){'), 'Runtime vehicle solver is missing');
assert(html.includes('const positions=roadsDisplayOverride?solveRoadVehiclePositions(48):roadVehiclePositions;'), 'Imported roads must drive vehicle placement');
assert(html.includes('if(idx.some(i=>Math.abs(rv[i*3+2]-top)>.02))continue;'), 'Vehicles must be placed on the road top surface only');
assert(html.includes('if(!fits(lx,ly,ux,uy))continue;'), 'Car footprint must be verified against the road mesh');
assert(!html.includes("vehicleGroup.name='2.3dm roads | legacy vehicle positions withheld'"), 'Vehicles are still withheld on the imported roads');
assert(html.includes('if(model.meta?.imported&&!roadsDisplayOverride)toggle.disabled=true;'), 'Vehicle toggle must be usable once traffic is source-solved');
// WATER v27 — on the imported site the roads sit in a -1 m trench at the same
// level as the old water bed, so the water must be read from the imported mesh
// with the road footprint subtracted, not from the embedded baseline site.
assert(html.includes('function importedRecessedWater(){'), 'Road-aware water reader is missing');
assert(html.includes("if(typeof siteDisplayOverride!=='undefined'&&siteDisplayOverride)return (nativeChannelCache=importedRecessedWater());"), 'Water must be derived from the imported site when one is loaded');
assert(html.includes('const site=siteDisplayOverride,roads=model?.roads;'), 'Water reader must use the imported site and roads');
assert(html.includes('bridged.has(k)?[poly]:subtractRoads(poly)'), 'Road trenches must be clipped from the final water footprint, except at crossings');
// A road crossing a channel is a bridge: the bed runs on underneath, so the
// footprint must NOT be cut there or the channel is severed at every kerb.
assert(html.includes('const bridged=new Set();'), 'Channel/road crossings are not detected');
assert(html.includes('if(!isBedFace(f)||!roadAt(f.center[0],f.center[1]))continue;'), 'Crossing test must only consider road-covered bed faces');
assert(html.includes('reaches(f.center[0],f.center[1],dx,dy)&&reaches(f.center[0],f.center[1],-dx,-dy)'), 'A crossing needs water on two opposite sides');
assert(html.includes('if(floor-z<=3.0001)floor=Math.min(floor,z)'), 'Terrace ladder must bound the flood above the slab underside');
assert(html.includes("const site=model?.site,basin=model?.parcels?.find(p=>p.id==='P-24');"), 'Embedded baseline must keep its original P-24 water rule');
// WATER BODY v28 — the footprint must carry the real bed elevation so the
// surface can be depth-tinted and the site cut can be closed into a body.
assert(html.includes('const tri=[poly[0],poly[j],poly[j+1]].map(p=>[p[0],p[1],p[2]]);'), 'Water footprint must keep the bed elevation');
assert(html.includes("const SHALLOW=new THREE.Color('#8fc6dd'),DEEP=new THREE.Color('#1d5878');"), 'Depth tint ramp is missing');
assert(html.includes("const CUT_TOP=new THREE.Color('#8cc3dc'),CUT_BED=new THREE.Color('#1b4762');"), 'Section-cut ramp is missing');
assert(html.includes('ramp(CUT_TOP,CUT_BED,waterline-p[1],wallColors);'), 'Section wall must shade by true depth');
assert(html.includes("channelGeom.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));"), 'Water surface must carry per-vertex depth colour');
assert(html.includes('vertexColors:true'), 'Water material must use the depth colours');
assert(html.includes("wallMesh.name='场地切面上的水体剖面';"), 'Water body section wall is missing');
assert(html.includes('if(!onCut(a)||!onCut(b))continue;'), 'Only the site cut may be closed into a wall');
// Road-covered bed faces remain dry at the water boundary.
assert(html.includes('result.kerbFaces=0;'), 'Road boundary must remain dry');
assert(!html.includes('for(const k of kerb)selected.add(k);'), 'Road-covered faces were added back to the water');
// A single selected site face can cross a road while its centre remains dry.
// Its water footprint must be clipped on both road edges, with the dry strip
// removed and the two connected wet sides preserved.
const waterReader = html.slice(html.indexOf('function importedRecessedWater(){'), html.indexOf('function nativeRecessedChannel(){'));
const triangleCheck = html.slice(html.indexOf('function pointInTriangle2D('), html.indexOf('function intersectsWaterFootprint('));
const waterContext = {
  siteDisplayOverride: {v:[0,0,-1,30,0,-1,0,30,-1],t:[0,1,2]},
  model:{roads:{v:[12,0,1,17,0,1,17,30,1,12,30,1],t:[0,1,2,0,2,3]}},
  WATER_RECESS_SOURCE_LEVEL:-1,console:{info(){}},Math,Map,Set
};
vm.runInNewContext(triangleCheck+waterReader+';globalThis.waterResult=importedRecessedWater()',waterContext);
assert(Math.abs(waterContext.waterResult.area-372.5)<.001, 'Road overlap was not removed precisely from the water footprint');
assert(waterContext.waterResult.triangles.some(t=>t.some(p=>p[0]<12)), 'Water on the left side was lost');
assert(waterContext.waterResult.triangles.some(t=>t.some(p=>p[0]>17)), 'Water on the right side was lost');
assert(waterContext.waterResult.triangles.every(t=>t.every(p=>p[0]<=12+1e-6||p[0]>=17-1e-6)), 'Water has vertices within the dry road strip');
// One of these two bed faces has its centre on the road. Discarding that whole
// face creates the diagonal missing wedge seen beside the real P-24 bridges.
waterContext.siteDisplayOverride={v:[0,0,-1,30,0,-1,30,30,-1,0,30,-1],t:[0,1,2,0,2,3]};
waterContext.model.roads={v:[10,0,1,15,0,1,15,30,1,10,30,1],t:[0,1,2,0,2,3]};
vm.runInNewContext('waterResult=importedRecessedWater()',waterContext);
assert(Math.abs(waterContext.waterResult.area-750)<.001, 'Road-centred source face caused a triangular gap in the channel');
// LANDSCAPE v29 — planting is cut against the live Roads mesh, not just the
// baseline parcel polygons, so nothing is planted on a 2.3dm carriageway.
assert(html.includes('function clearsCarriageway(x,y,r){'), 'Carriageway clearance test is missing');
assert(html.includes('&&clearsCarriageway(x,y,r*.8)&&freeFromStructure(x,y,r)}'), 'Planting must clear the carriageway');
assert(html.includes('const tint=Math.floor(rand()*3),spin=rand()*6.28'), 'Per-tree crown variation is missing');
// Clipping rebuilds vertices, so unpaired edges are no longer proof of a shore;
// an edge is drawn only where exactly one side of it is wet.
assert(html.includes('if(isWet(mx+nx,my+ny)===isWet(mx-nx,my-ny))continue;'), 'Shoreline must reject interior seams');
// ROAD LINES v31 — the source carries its own division lines on the Default layer.
assert(importer.includes('if(name===\"default\"&&geom&&typeof geom.pointAt===\"function\"&&geom.domain){'), 'Default-layer curves are not sampled');
assert(importer.includes('roadLineSegments:lines.v.length/6,'), 'Road line count is not reported');
assert(importer.includes('if(pts.length>1)lineParts.push(pts);'), 'Line points must be stored once per curve, not per segment endpoint');
assert(html.includes('roadLineOverride=importedModel.lines?.v?.length?importedModel.lines:null;'), 'Road lines are not applied');
assert(html.includes("lines.name='2.3dm Default 图层划线';"), 'Road lines are not drawn');
assert(fs.existsSync('2.3dm'), 'Default Rhino 2.3dm binary is missing from repository root');
const asset=fs.readFileSync('2.3dm');
assert(asset.length>10240, 'Default Rhino file appears incomplete');
assert(asset.subarray(0,24).toString('ascii').startsWith('3D Geometry File Format'), 'Default asset has no Rhino 3DM header');
console.log('PASS: published Rhino source, dual Site/Roads import, retained scene functions and syntax');
