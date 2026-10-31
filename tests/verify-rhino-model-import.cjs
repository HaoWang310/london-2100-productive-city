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
assert(html.includes('src="./latest-model-loader.js?v=20261031-site-frame-align-v27"'), 'Loader cache-busting token was not bumped for the site-frame alignment change');
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
assert(html.includes('let siteDisplayOverride=null, roadsDisplayOverride=null;'), 'Independent Site/Roads override state is missing');
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
assert(fs.existsSync('2.3dm'), 'Default Rhino 2.3dm binary is missing from repository root');
const asset=fs.readFileSync('2.3dm');
assert(asset.length>10240, 'Default Rhino file appears incomplete');
assert(asset.subarray(0,24).toString('ascii').startsWith('3D Geometry File Format'), 'Default asset has no Rhino 3DM header');
console.log('PASS: published Rhino source, dual Site/Roads import, retained scene functions and syntax');
