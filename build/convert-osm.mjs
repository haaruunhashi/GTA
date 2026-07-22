import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const j = JSON.parse(readFileSync('osm-raw.json', 'utf8'));
// ---- game city bounds (must match core.js CITY) ----
const CITY = { x0: 200, z0: 900, x1: 2900, z1: 3100 };
const TUN = [{ z: 1989, x0: 830, x1: 1770 }, { z: 1557, x0: 2580, x1: 3420 }];
// ---- projection anchors ----
const els = j.elements;
const B = els.filter(e => e.tags && e.tags.building && e.geometry && e.geometry.length > 2);
let mnlat=90,mxlat=-90,mnlon=180,mxlon=-180;
for (const e of B) for (const g of e.geometry){ if(g.lat<mnlat)mnlat=g.lat; if(g.lat>mxlat)mxlat=g.lat; if(g.lon<mnlon)mnlon=g.lon; if(g.lon>mxlon)mxlon=g.lon; }
const midLat=(mnlat+mxlat)/2, mPerLat=111320, mPerLon=111320*Math.cos(midLat*Math.PI/180);
const spanX=(mxlon-mnlon)*mPerLon, spanZ=(mxlat-mnlat)*mPerLat;
const margin=70, availX=(CITY.x1-CITY.x0)-2*margin, availZ=(CITY.z1-CITY.z0)-2*margin;
const scale=Math.min(availX/spanX, availZ/spanZ);
const offX=CITY.x0+margin+(availX-spanX*scale)/2, offZ=CITY.z0+margin+(availZ-spanZ*scale)/2;
const PX=(lon)=> offX+(lon-mnlon)*mPerLon*scale;
const PZ=(lat)=> offZ+(mxlat-lat)*mPerLat*scale;
const overTunnel=(x0,z0,x1,z1)=> TUN.some(t=> z1> t.z-22 && z0< t.z+22 && x1> t.x0 && x0< t.x1);
// ---- buildings -> AABB ----
const buildings=[];
for (const e of B){
  let x0=1e9,z0=1e9,x1=-1e9,z1=-1e9;
  for (const g of e.geometry){ const x=PX(g.lon), z=PZ(g.lat); if(x<x0)x0=x; if(x>x1)x1=x; if(z<z0)z0=z; if(z>z1)z1=z; }
  if ((x1-x0)*(z1-z0) < 26) continue;            // drop tiny sheds
  if (x0<CITY.x0||x1>CITY.x1||z0<CITY.z0||z1>CITY.z1) continue;
  if (overTunnel(x0,z0,x1,z1)) continue;          // keep tunnel corridors clear
  const t=e.tags; let h=0;
  if (t.height) h=parseFloat(t.height);
  else if (t['building:levels']) h=parseFloat(t['building:levels'])*3.3;
  if (!(h>0)) h=10+ (Math.abs(x0*31+z0*17)%18);
  h=Math.min(h*scale*1.6, 300);                   // scale up vertical a touch for skyline drama, cap
  h=Math.max(h, 6);
  buildings.push({ x0:+x0.toFixed(1), z0:+z0.toFixed(1), x1:+x1.toFixed(1), z1:+z1.toFixed(1), h:+h.toFixed(1), kind: h>45?'tower':'block' });
}
// ---- drivable road graph ----
const DRIVE=new Set(['motorway','trunk','primary','secondary','tertiary','residential','unclassified','living_street','motorway_link','trunk_link','primary_link','secondary_link','tertiary_link']);
const H = els.filter(e=> e.tags && DRIVE.has(e.tags.highway) && e.geometry && e.geometry.length>1 && e.nodes);
const nodeIndex=new Map(); const nodes=[]; const edges=[]; const roadways=[];
function nid(osmId, lon, lat){
  if (nodeIndex.has(osmId)) return nodeIndex.get(osmId);
  const x=PX(lon), z=PZ(lat); const i=nodes.length; nodes.push([+x.toFixed(1),+z.toFixed(1)]); nodeIndex.set(osmId,i); return i;
}
const inCity=(x,z)=> x>CITY.x0&&x<CITY.x1&&z>CITY.z0&&z<CITY.z1;
for (const e of H){
  const way=[];
  for (let k=0;k<e.nodes.length;k++){
    const g=e.geometry[k]; if(!g) continue;
    const x=PX(g.lon), z=PZ(g.lat); if(!inCity(x,z)){ way.length&&roadways.push(way.slice()); way.length=0; continue; }
    const i=nid(e.nodes[k], g.lon, g.lat); way.push(i);
  }
  if (way.length>1) roadways.push(way);
  for (let k=0;k+1<way.length;k++){ if(way[k]!==way[k+1]) edges.push([way[k],way[k+1]]); }
}
// dedupe edges
const eseen=new Set(); const uedges=[];
for (const [a,b] of edges){ const key=a<b?a+'_'+b:b+'_'+a; if(eseen.has(key))continue; eseen.add(key); uedges.push([a,b]); }
const data={ buildings, nodes, edges:uedges, roadways };
const js='// Auto-generated from OpenStreetMap (Lower Manhattan). Map data © OpenStreetMap contributors, ODbL.\n'+
  '(function(root){root.FC_CITYDATA='+JSON.stringify(data)+';if(typeof module!=="undefined"&&module.exports)module.exports=root.FC_CITYDATA;})(typeof window!=="undefined"?window:globalThis);\n';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'citydata.js');
writeFileSync(OUT, js);
console.log('buildings',buildings.length,'nodes',nodes.length,'edges',uedges.length,'roadways',roadways.length);
console.log('towers>60m',buildings.filter(b=>b.h>60).length,'maxH',Math.max(...buildings.map(b=>b.h)).toFixed(0));
console.log('scale',scale.toFixed(3),'file bytes',js.length);
