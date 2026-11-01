#!/usr/bin/env node
// Climate mode: the physics, checked against the real EPW rather than against
// the code's own opinion of itself. Everything here is a pure function lifted
// straight out of index.html and run on london.epw, so a change to either one
// that breaks the numbers fails here instead of on the published site.
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const epwText=fs.readFileSync(path.join(root,'london.epw'),'utf8');

function lift(name){
 const i=html.indexOf('function '+name+'(');
 assert.ok(i>=0,'index.html no longer defines '+name+'()');
 let d=0,j=html.indexOf('{',i);
 for(let k=j;k<html.length;k++){
  if(html[k]==='{')d++;else if(html[k]==='}'){d--;if(!d)return html.slice(i,k+1)}
 }
 throw new Error('unbalanced braces in '+name);
}
function constLine(re,label){
 const m=html.match(re);
 assert.ok(m,'index.html no longer declares '+label);
 return m[0];
}

const consts=[
 constLine(/const MET_Z=10,MET_Z0=\.03,SITE_Z0=\.1,BLEND_Z=60,PED_Z=1\.75;/,'the wind profile constants'),
 constLine(/const MET_UP=Math\.log\(BLEND_Z\/MET_Z0\)\/Math\.log\(MET_Z\/MET_Z0\);/,'the blending-height ratio'),
 constLine(/const LAWSON=\[[\s\S]*?\];/,'the Lawson scale'),
 constLine(/const MONTH_DAYS=\[[^\]]*\];/,'MONTH_DAYS'),
].join('\n');

const api=new Function(consts+'\n'+
 [lift('parseEpw'),lift('windAtHeight'),lift('sunPosition'),lift('shadowStrength')].join('\n')+
 '\nreturn {parseEpw,windAtHeight,sunPosition,shadowStrength,LAWSON,MET_UP,PED_Z};')();

const out={};
// ---------------------------------------------------------------- the file
const epw=api.parseEpw(epwText);
assert.strictEqual(epw.hours.length,8760,'EPW must hold a full year');
assert.ok(Math.abs(epw.loc.lat-51.885)<1e-3,'latitude moved');
assert.ok(Math.abs(epw.loc.lon-0.235)<1e-3,'longitude moved');
assert.strictEqual(epw.loc.tz,0,'the file is UTC; the solar clock assumes it');
out.site={lat:epw.loc.lat,lon:epw.loc.lon,hours:epw.hours.length};

// The prevailing wind over southern England is south-westerly. If this ever
// comes out northerly, the 22.5-degree sector rounding has been broken.
const DIR16=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];
assert.strictEqual(DIR16[epw.prevailing],'SW','prevailing wind is no longer south-westerly');
assert.ok(epw.meanWind>3.5&&epw.meanWind<4.5,'mean wind out of range: '+epw.meanWind);
assert.ok(epw.annual.ghi>950&&epw.annual.ghi<1200,'annual GHI out of range: '+epw.annual.ghi);
out.climate={prevailing:DIR16[epw.prevailing],meanWind:+epw.meanWind.toFixed(2),
 calmPct:+epw.calmPct.toFixed(1),annualGHI:Math.round(epw.annual.ghi)};

// ------------------------------------------------- the wind height profile
// Davenport two-step: airport 10 m / z0 0.03 up to 60 m, back down on the
// site's own z0 0.5. The whole point is that it REDUCES the met speed; a
// regression that drops a logarithm tends to make it larger instead.
const ped=api.windAtHeight(13.4,1.75);
assert.ok(ped>7.3&&ped<8.4,'pedestrian speed from 13.4 m/s should be ~7.8, got '+ped);
assert.ok(api.windAtHeight(13.4,1.75)<13.4,'the correction must reduce the airport speed');
for(const z of [2,5,10,20])
 assert.ok(api.windAtHeight(7,z)>api.windAtHeight(7,z/2),'profile not increasing with height at '+z);
assert.ok(Math.abs(api.MET_UP-1.3085)<2e-3,'blending-height ratio moved: '+api.MET_UP);
out.profile={from13_4at1_75:+ped.toFixed(2),at10:+api.windAtHeight(13.4,10).toFixed(2),
 METUP:+api.MET_UP.toFixed(4)};

// ------------------------------------------------------- the solar position
// Summer solstice noon at 51.885N must be 90 - lat + 23.44 = 61.6 degrees.
const noon=api.sunPosition(epw.loc.lat,epw.loc.lon,0,172,12);
assert.ok(Math.abs(noon.altitude-61.6)<1.2,'solstice noon altitude wrong: '+noon.altitude);
assert.ok(Math.abs(noon.azimuth-180)<6,'solstice noon should be due south, got '+noon.azimuth);
// Winter solstice noon: 90 - lat - 23.44 = 14.7 degrees.
const wnoon=api.sunPosition(epw.loc.lat,epw.loc.lon,0,355,12);
assert.ok(Math.abs(wnoon.altitude-14.7)<1.2,'winter noon altitude wrong: '+wnoon.altitude);
// The sun rises in the north-east and sets in the north-west in a London June.
const dawn=api.sunPosition(epw.loc.lat,epw.loc.lon,0,172,5);
const dusk=api.sunPosition(epw.loc.lat,epw.loc.lon,0,172,19);
assert.ok(dawn.azimuth<110,'June 05:00 sun should be in the north-east, got '+dawn.azimuth);
assert.ok(dusk.azimuth>250,'June 19:00 sun should be in the north-west, got '+dusk.azimuth);
assert.ok(dawn.altitude>0&&dusk.altitude>0,'both should be above the horizon in June');
// and it is below the horizon at midnight, every day of the year
for(let d=1;d<=365;d+=29)
 assert.ok(api.sunPosition(epw.loc.lat,epw.loc.lon,0,d,0).altitude<0,'midnight sun on day '+d);
out.sun={solsticeNoon:+noon.altitude.toFixed(1),winterNoon:+wnoon.altitude.toFixed(1),
 juneDawnAz:Math.round(dawn.azimuth),juneDuskAz:Math.round(dusk.azimuth)};

// ------------------------------------------------- the annual sunlight count
// An unobstructed lot must read the file's own count of hours with a usable
// beam, because that is exactly what the sunFreq weighting integrates to.
let bright=0;
for(const h of epw.hours)if(h.dni>120)bright++;
let unobstructed=0;
for(let m=0;m<12;m++)for(let h=3;h<=21.01;h+=.5)
 unobstructed+=.5*MONTH_DAYS_FROM(m)*epw.sunFreq[m+1][Math.min(23,Math.floor(h))];
function MONTH_DAYS_FROM(m){return [31,28,31,30,31,30,31,31,30,31,30,31][m]}
assert.ok(Math.abs(unobstructed-bright)/bright<.02,
 'the weighting should integrate to the file\'s bright hours: '+Math.round(unobstructed)+' vs '+bright);
out.sunlight={brightHoursInFile:bright,unobstructedLotReads:Math.round(unobstructed)};

// --------------------------------------------------------- shadow strength
// No beam, no shadow. A clear beam, a strong one. Overcast, almost none.
assert.strictEqual(api.shadowStrength(0,300),0,'a sunless hour must cast no shadow');
assert.ok(api.shadowStrength(850,110)>.45,'a clear hour should cast a strong shadow');
assert.ok(api.shadowStrength(60,280)<.08,'an overcast hour should cast almost none');
assert.ok(api.shadowStrength(850,110)>api.shadowStrength(228,295),
 'a clear hour must out-shadow a hazy one');
out.shadow={clear:+api.shadowStrength(850,110).toFixed(3),
 hazy:+api.shadowStrength(228,295).toFixed(3),overcast:+api.shadowStrength(60,280).toFixed(3)};

// ------------------------------------------------------------ Lawson scale
assert.strictEqual(api.LAWSON.length,5,'the Lawson scale lost a category');
assert.deepStrictEqual(api.LAWSON.map(l=>l.v).slice(0,4),[4,6,8,10],'Lawson thresholds moved');
assert.deepStrictEqual(api.LAWSON.map(l=>l.k),['久坐','站立','漫步','快走','不适']);
// The whole site exposed: what grade would an open lot get?
const hist=new Float64Array(81);let n=0;
for(const x of epw.hours){if(x.ws<.3)continue;hist[Math.min(80,Math.round(api.windAtHeight(x.ws,1.75)*2))]++;n++}
let acc=0,v5=0;
for(let k=80;k>=0;k--){acc+=hist[k];if(acc>=n*.05){v5=k/2;break}}
// A fully exposed lot must NOT land in the gentlest grade: if it does, every
// sheltered lot lands there too and the map carries no information.
assert.ok(v5>4&&v5<9,'a fully exposed lot should sit in the walkable range, got '+v5);
assert.ok(api.LAWSON[0].v<v5,'an exposed lot graded as comfortable for sitting — shelter counted twice?');
let cat=0;while(cat<api.LAWSON.length-1&&v5>api.LAWSON[cat].v)cat++;
out.lawson={fullyExposedV5:v5,grade:api.LAWSON[cat].k};

// ------------------------------------------- the wiring, checked as source
const must=[
 ['climateBeam(',              'the clear-sky / EPW beam switch'],
 ['solveWindComfort(',         'the Lawson solver'],
 ['updateSunPath(',            'the sun-path arc'],
 ["id=\"clSky\"",              'the 晴空 toggle'],
 ["id=\"clPath\"",             'the 太阳轨迹 toggle'],
 ["id=\"clLegend\"",           'the per-analysis legend'],
 ['windAtHeight(h.ws,PED_Z)',  'the pedestrian wind readout'],
 ['sunHours.lo',               'the stretched sun ramp'],
 ['lo:pick(.02),hi:pick(.98)', 'the ramp percentiles'],
 ['const WIND_N=2200',         'the particle count raised for visibility'],
 ['opacity:.88',               'the particle opacity raised for visibility'],
 ['Math.min(14,3+spd*1.4)',    'the cap that stops a gale reading as rain'],
 ['edgePoint=',                'upwind release of the particles'],
 ['LAWSON[w.cat].k',           'the Lawson grade in the CSV'],
];
for(const [needle,why] of must)
 assert.ok(html.includes(needle),'index.html has lost '+why+' ('+needle+')');
// and the retired metric must not come back
assert.ok(!html.includes('solveWindShelter'),'the old openness metric is still referenced');
assert.ok(!/shadowStrength\(h\)/.test(html),'shadowStrength is still being handed an EPW row');

console.log(JSON.stringify(out,null,1));
console.log('PASS: EPW parsing, wind profile, solar geometry, sunlight count, shadow strength, Lawson scale');
