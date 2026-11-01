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
assert(html.includes('src="./latest-model-loader.js?v=20261031-road-detail-v33"'), 'Loader cache-busting token was not bumped for the road-line change');
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
// WebGL ignores line width, so markings are ribbons sized by the importer.
assert(importer.includes('f.bold=beside>=2;'), 'Zebra rungs are not told apart from lane dashes');
assert(html.includes('const wd=lw[seg]||.16,'), 'Markings are not drawn at their classified width');
// A centre line painted straight through a zebra is the marking a real road
// never has, so lane work is clipped against the crossing zones.
assert(html.includes('const inCrossing=(x,y)=>{'), 'Lane work is not clipped at the crossings');
// Nor across the middle of an intersection, where the source draws turning
// curves that read as a stray line on open asphalt.
assert(html.includes('for(const b of boxes)if(Math.hypot(x-b.cx,y-b.cy)<b.r)return !onIsland(x,y);'), 'Lane work must be cleared out of the junction box');
assert(html.includes('r:Math.min(n.r+3,Math.max(n.r,nearest-1))'), 'The junction box must never reach past its crossings');
// An island outline is the island's kerb, not a lane marking.
assert(html.includes('const onIsland=(x,y)=>{'), 'Island outlines must survive the junction clip');
assert(html.includes("ribbon(roadLineOverride.v,roadLineOverride.w||[],true);"), 'Source lane work must be clipped');
assert(html.includes("ribbon(roadCrossingOverride.v,roadCrossingOverride.w,false);"), 'Crossing bars must not clip themselves');
assert(html.includes('if(atSiteEdge(i,j))continue;'), 'Median flood must not seed from the site boundary');
assert(html.includes('if(medianLookup&&medianLookup(px,py))return false;'), 'Traffic must keep off the medians');
assert(html.includes('if(onCrossing(px,py))return false;'), 'Traffic must keep off the crossings');
// A car astride a painted line is the first thing the eye catches, and the
// lane offset alone cannot know where the source drew its lines.
assert(html.includes('if(onPaint(x,y,ux,uy,CAR_LEN/2+.15,CAR_WID/2+.15))return false;'), 'No car may straddle a painted line');
// Heading follows the lane work; the longest-run test is only a fallback.
assert(html.includes('const ang=laneAngleAt(x,y);if(ang===null)continue;'), 'Car heading must come from the lane lines, with no guess fallback');
assert(html.includes('if(runLength(x,y,ang)<18)continue;'), 'A car must have road ahead and behind');
// MEDIANS v32 — islands are enclosed by open line work, so they are found by
// flooding the carriageway raster, not by reading closed curves.
assert(html.includes('function buildRoadMedians(group){'), 'Median detection is missing');
assert(html.includes("strip.name='道路绿化隔离带';"), 'Median planting strip is not drawn');
assert(html.includes('const med=buildRoadMedians(roadDesignGroup);'), 'Medians are not built with the road lines');
// FURNITURE v34 — signals sit at the ends of a crossing, lighting on the kerb.
assert(html.includes('function buildRoadFurniture(group){'), 'Road furniture is missing');
assert(html.includes('if(group2.length<3)continue;'), 'A lone bar must not be treated as a crossing');
// A row that reaches both kerbs is wider than the 9 m search radius, so the
// group has to grow along the row; from the seed alone it split, and the split
// put a crossing end, and a pole, in the middle of the road.
assert(html.includes('const r0=rungs[group2[a]],m0=[(r0[0]+r0[2])/2,(r0[1]+r0[3])/2];'), 'Rung clustering must grow along the row');
assert(html.includes('if(!onRoad(ex+ux*t2*sgn2,ey+uy*t2*sgn2)){off=t2+.6;break}'), 'Signal poles must be walked out to the kerb');
assert(html.includes('const px=-Math.sin(di),py=Math.cos(di);'), 'A crossing spans across its bars, not along them');
assert(html.includes('const furniture=buildRoadFurniture(roadDesignGroup);'), 'Furniture is not built with the road detail');
// PARCEL VIEW v34 — the Form library isolates one plot and hides the site mesh.
// Water and planting are modelled against that site, so they must go with it or
// they cut across the plot and show their section walls from the inside.
assert(html.includes("if(state.mode==='report'&&(reportFormId||reportParcel!=='all')){waterGroup.visible=false;return}"), 'Water must be hidden in the parcel and Form views');
assert(html.includes('g.visible=landscapeConfig.enabled&&allView&&!plots&&(showAll||ids.includes(id));'), 'Planting must be hidden in the parcel, Form and land views');
// FIN TRIM v35 — a strip of a slab's edge wall that runs past the surfaces it
// belongs to is drawn as a hair sticking out of the Form. Run the real trim
// over the embedded model and check what it did, not just that it is present.
{
 const zlib = require('node:zlib');
 const g = html.match(/MODEL_GZIP\s*=\s*['"]([A-Za-z0-9+/=]+)['"]/);
 assert(g, 'Embedded model payload is missing');
 const embedded = JSON.parse(zlib.gunzipSync(Buffer.from(g[1], 'base64')).toString());
 const from = html.indexOf('const FIN_WIDTH=');
 assert(from > 0, 'Fin trim constants are missing');
 const src = html.slice(from, html.indexOf('\n}\n', html.indexOf('function trimLooseFins')) + 3);
 const sandbox = {};
 vm.createContext(sandbox);
 vm.runInContext(src + '\nthis.trimLooseFins = trimLooseFins; this.FIN_WIDTH = FIN_WIDTH;', sandbox);
 const before = embedded.units.map(u => u.mesh.t.length / 3);
 const report = sandbox.trimLooseFins(embedded.units);
 assert(report.removed > 1200, 'Fin trim removed almost nothing: ' + report.removed);
 // Thin plates are a real part of the design; the trim must never eat one.
 // (the report is built inside the vm context, so compare it as text)
 assert.equal([...report.leftAsModelled].sort().join(','), 'C-11-17-S1,E-01',
  'Unexpected set of units left as modelled: ' + report.leftAsModelled.join(','));
 for (const id of report.leftAsModelled) {
  const i = embedded.units.findIndex(u => u.id === id);
  assert.equal(embedded.units[i].mesh.t.length / 3, before[i], id + ' must keep every face');
 }
 const after = embedded.units.reduce((s, u) => s + u.mesh.t.length / 3, 0);
 assert.equal(report.scanned - report.removed, after, 'Trim report does not match the meshes it wrote');
 assert(report.removed / report.scanned < .05, 'Trim took too much of the model');
 // Nothing exposed should be left behind: a second run has nothing to do.
 assert.equal(sandbox.trimLooseFins(embedded.units).removed, 0, 'Fin trim is not stable');
 // And no vertex moved — the trim only drops faces.
 assert(embedded.units.every(u => u.mesh.t.every(i => i * 3 + 2 < u.mesh.v.length)),
  'Trim left an index pointing outside the vertex list');
}
// NAVIGATOR WATER v36 — the water belongs to no parcel since the re-cut, so the
// navigator has to read it from the same footprint the 3D water is built from.
assert(html.includes('function overviewWaterFootprint(){'), 'Navigator water footprint is missing');
assert(html.includes("svg.innerHTML=overviewWaterPath()+overviewRoadPath()+model.parcels.map("), 'Water and roads must be drawn under the parcels');
assert(html.includes(".concat(overviewWaterFootprint().flat()).concat(overviewRoadFootprint().flat());"), 'Navigator extent must cover the water and the roads');
// The carriageways were only the gaps between parcels, so a road with no plot
// beside it — along the lagoon, at the site edge — was simply not drawn.
assert(html.includes('function overviewRoadFootprint(){'), 'Navigator road footprint is missing');
assert(html.includes('if(L<1e-9||n[2]/L<=.86)continue;'), 'Only the up-facing road deck belongs on a plan');
assert(html.includes(".formOverviewRoad{fill:#1b2026;"), 'Navigator road style is missing');
assert(html.includes("fillTris(water,'#2c5f7a');fillTris(road,'#1b2026');"), 'All-site thumbnail must draw the same roads');
assert(html.includes(".formOverviewWater{fill:#2c5f7a;"), 'Navigator water style is missing');
assert(html.includes("pointer-events:none;vector-effect:non-scaling-stroke}.formOverviewWater") || html.includes(".formOverviewWater{fill:#2c5f7a;stroke:#2c5f7a;stroke-width:.7;pointer-events:none"), 'Navigator water must not swallow parcel clicks');
assert(html.includes("const water=overviewWaterFootprint(),road=overviewRoadFootprint();const pts=model.parcels"), 'All-site thumbnail must draw the same water and roads');
// CROSSINGS v37 — the source stops its rows short of the kerb and leaves some
// junction arms bare; the completion must stay measured, not styled.
assert(html.includes('function completeCrossings(){'), 'Crossing completion is missing');
assert(html.includes('let roadCrossingOverride=null;'), 'Completed crossings need their own channel');
assert(html.includes('const med=buildRoadMedians(roadDesignGroup);\n   if(med)roadDesignGroup.userData.medians=med;\n   roadCrossingOverride=completeCrossings();'),
 'Medians must be found from the source line work before the crossings are completed');
assert(html.includes('for(const src of [roadLineOverride,roadCrossingOverride]){'), 'Signals must read the completed crossings');
// A bar is laid only where the whole of it is on the carriageway and off a median.
assert(html.includes('const barFits=(mx,my,ux,uy,len)=>{'), 'Bars must be tested against the carriageway');
assert(html.includes('if(!clearOfMedian(mx,my))continue;'), 'A crossing must not run across a planted median');
// A crossing matches the carriageway it crosses, not the junction beside it:
// the section is taken on the approach side only, and the narrowest one wins.
assert(html.includes('const offsets=[0,3,6,10].map(d=>d*away);'), 'Crossing reach must be measured on the approach side');
assert(html.includes('if(node){const towards=(node.cx-cx)*ux+(node.cy-cy)*uy;away=towards>0?-1:1}'), 'The approach side is the one away from the junction');
// A new crossing starts beyond the junction's own circle, never in the mouth.
assert(html.includes('for(let s2=Math.ceil(r)+3;s2<=Math.ceil(r)+14;s2++){'), 'A new crossing must stand back from the junction');
// Bar length, width and pitch are read from the source rows, never typed in.
assert(html.includes('const BAR=median(rungs.map(r=>Math.hypot(r[2]-r[0],r[3]-r[1])));'), 'Bar length must come from the source');
assert(html.includes('const PITCH=pitches.length?median(pitches):1;'), 'Bar pitch must come from the source');
// LAND PLOTS v38 — the cells the roads and the structures cut the site into.
// The site mesh is too coarse to answer this face by face, so the plan is
// rasterised and the boundary traced back off the raster.
assert(html.includes('function solveLandPlots(){'), 'Land plot solver is missing');
assert(html.includes('<button data-mode="plots">用地</button>'), 'The land mode is not in the nav');
assert(html.includes("document.body.classList.toggle('plotsMode',mode==='plots');"), 'The land panel is not shown with the mode');
assert(html.includes("if(!landPlots.length)buildLandPlots();"), 'Plots must be solved on entering the mode');
// Roads, water and the plan projection of every structure are painted out.
assert(html.includes('for(const tri of water.triangles)paint(tri,3);'), 'Water must be cut out of the land');
// Painted with only=1 these classes came out almost empty — 65 m² of
// carriageway for a 42,007 m² network — because the ground under a road is in
// the trench, below the waterline, and was never painted as ground to begin
// with. They are painted over anything now, latest wins.
assert(html.includes('{const v=roads.v,t=roads.t;\n  for(let k=0;k<t.length;k+=3)paint([0,1,2].map(j=>{const i=t[k+j]*3;return[v[i],v[i+1]]}),4);}'),
 'The carriageway class must be painted over anything');
assert(html.includes('const walkable=k=>k===1||k===5;'), 'The walk to the street passes under the elevated structures');
assert(html.includes('const nearBand=best+8/G;'), 'The frontage is the plot\'s own closest approach to a street');
assert(html.includes("if(Math.abs(sgn(p[0],p[1],p[2]))<.02)continue;      // seen edge on, no footprint"), 'Structure footprints must be cut out of the land');
// The same simplified outline serves the view, the area and the DXF.
assert(html.includes('function simplifyRing(pts,eps){'), 'Plot outlines must be simplified once');
assert(html.includes("poly(ring,'PLOT_'+p.id)"), 'DXF export is missing');
assert(html.includes("(x+o[0]).toFixed(3),'20',(y+o[1]).toFixed(3)"), 'DXF must carry Rhino world coordinates');
assert(html.includes('function exportPlotsCSV(){'), 'Plot schedule export is missing');
assert(html.includes("if(state.mode==='plots'){const lp=plotAt(e);"), 'Plots must be selectable in the view');
// LAND USE v40 — green frame first, buildings second, capacity from the ratio.
assert(html.includes('function planLandUse(){'), 'Land use planning is missing');
assert(html.includes('const dWater=bfs(k=>k===3,ground),dRoad=bfs(k=>k===4,walkable),dStruct=bfs(k=>k===5,ground);'), 'The three setback bands must be distance transforms');
assert(html.includes('if(klass[c]===1&&dWater[c]>bw&&dRoad[c]>br&&dStruct[c]>bs)free[c]=1;'), 'Net developable ground must exclude all three bands');
assert(html.includes('const gfaTarget=p.area*landUse.far;'), 'Capacity must come from the floor area ratio');
assert(html.includes('short:Math.max(0,gfaTarget-footprint*landUse.storeys)'), 'A plot that cannot meet the ratio must report the shortfall, not force it');
// The building band grows inward FROM the street, so the green stays whole at the back.
assert(html.includes('if(dRoad[c]<=nearBand){d[c]=0;q[tail++]=c}'), 'Depth must be measured from the frontage');
assert(html.includes("const tag=-(20+gidx);for(const c of list)use[c]=tag;"), 'Each green piece needs its own tag or tracing picks up its neighbour');
assert(html.includes("poly(ring,'BUILD_'+p.id)")&&html.includes("poly(ring,'GREEN_'+p.id)"), 'Buildings and green must export on their own layers');
// THEME v39 — the interface was only half converted to dark: chips, view bar,
// badge, labels, report cards and toast were still light-mode fills.
assert(html.includes('<style id="apple-dark-v39">'), 'The dark theme layer is missing');
assert(html.lastIndexOf('<style id="apple-dark-v39">') > html.lastIndexOf('<style id="form-resizable-layout-v14">'),
 'The theme layer must come last so it wins on equal specificity');
assert(html.includes('--sys-blue:#0a84ff;'), 'The system accent is missing');
for (const sel of ['.layer,.viewbar,.explodePanel,.badge,.label,.tooltip,.toast,.plotsPanel,.formOverview{'])
 assert(html.includes(sel), 'Floating chrome must be a material, not a white card: ' + sel);
// Black ground in the land mode, picked plots in the same accent as the UI.
assert(html.includes("const base=flat(p,'#07080a',.82,.34);"), 'Land plots must read black');
assert(html.includes("flat(g,'#30d158',.3,.38)")&&html.includes("flat(b,'#e8ebf0',.92,.42)"), 'Green and building areas must be drawn');
assert(html.includes("m.material.color.set(on?'#0a84ff':hot?'#1d2026':'#07080a');"), 'Plot selection must use the system accent');
assert(fs.existsSync('2.3dm'), 'Default Rhino 2.3dm binary is missing from repository root');
const asset=fs.readFileSync('2.3dm');
assert(asset.length>10240, 'Default Rhino file appears incomplete');
assert(asset.subarray(0,24).toString('ascii').startsWith('3D Geometry File Format'), 'Default asset has no Rhino 3DM header');
console.log('PASS: published Rhino source, dual Site/Roads import, retained scene functions and syntax');
