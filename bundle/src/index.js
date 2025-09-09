// index.js - Ark Camera ID (optimized + Admin Office defaults)

/* public path: github.io uses /Securitycam/, custom domain uses / */
__webpack_public_path__ = (location.hostname.endsWith('github.io') ? '/Securitycam/' : '/');

   const ASSET_BASE = location.hostname.endsWith('github.io') ? '/Securitycam/' : '/';

// Import the viewer web component
import '@matterport/webcomponent';

/* ========================= Branding ========================= */
document.title = 'Ark Camera ID';
const BRAND_NAME  = 'ARK Security';
const PANEL_TITLE = 'Ark Camera Controls';

/* ========================= Tunables ========================= */
const PERF = {
  // projector grid sizes (lower = faster)
  INDOOR_GRID:  { u: 10, v: 6 },
  OUTDOOR_GRID: { u: 10, v: 6 },

  // how often dynamic projectors (cafeteria + Admin Office) recompute
  dynamicHz: 8,

  // keep your existing thresholds if you were using them
  PROJECTOR_MIN_DT: 120,
  OUTDOOR_MIN_DT: 140,
  MIN_MOVE: 0.06,
  MIN_YAW_DEG: 1.0,
};
const clamp = (v,min,max)=>Math.max(min,Math.min(max,v));

/* ========================= Config ========================= */
const CFG = {
  // Cafeteria cam position & optics (indoor)
  position: { x: 45.259, y: 4.0, z: -9.45 },

  aspect: 16 / 9,
  hFovDeg: 32,
  near: 0.12,
  far: 19,
  nearApertureScale: 0.22,

  // Cafeteria sweep motion (indoor only)
  sweepDeg: 122,
  baseYawDeg: 93,
  tiltDeg: 10,
  yawSpeedDeg: 14,

  // FOV styling (shared)
  fovColor: 0x00ff00,
  fillOpacity: 0.08,
  edgeRadius: 0.016,
  baseEdgeRadius: 0.010,

  // Projector (indoor fallback floor)
  floorY: 0.4,
  footprintOpacity: 0.18,
  projectorGrid: { u: PERF.U, v: PERF.V },

  // Stylized body colors
  camText: '#f59e0b',
  camWhite: 0xffffff,
  cableBlack: 0x111111,
};

const DEBUG = false;

/* ===== Cafeteria gating ===== */
const BOUND_ROOM_ID = 'cdz3fkt38kae7tapstpt0eaeb';
const USE_SWEEP_GATE = true;
const USE_ROOM_GATE  = true;
const SHOW_IN_FLOORPLAN = true;

/* ===== Outdoor tag labels look like “Security Camera …” ===== */
const OUTDOOR_TAG_MATCH = /^\s*security\s*camera\b/i;

/* ===== Admin Office defaults (pan within its room) ===== */
const ADMIN_LABEL = 'Security Camera - Admin Office';
const ADMIN_DEFAULTS = {
  // From your screenshot
  hFovDeg: 36, near: 0.12, far: 6,
  yawDeg: -130, tiltDeg: 14,
  sweepDeg: 46, yawSpeedDeg: 22,
};

/* ================= Infrastructure ================= */
const rigs = new Map();           // id -> { id, label, type, cfg, refs, rebuild, applyTilt }
window._rigs = rigs;
function registerRig(entry) { rigs.set(entry.id, entry); }
const log = (...a) => { if (DEBUG) console.log('[SECAM]', ...a); };
const deg2rad = d => d * Math.PI / 180;

/* =================== Geometry helpers =================== */
function frustumDims(THREE, hFovDeg, aspect, dist) {
  const h = deg2rad(hFovDeg);
  const v = 2 * Math.atan(Math.tan(h / 2) / aspect);
  return { halfW: Math.tan(h / 2) * dist, halfH: Math.tan(v / 2) * dist, dist };
}
function tubeBetween(THREE, a, b, radius, material) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (len <= 1e-6) return new THREE.Object3D();
  const geom = new THREE.CylinderGeometry(radius, radius, len, 12, 1, true);
  const mesh = new THREE.Mesh(geom, material);
  const up = new THREE.Vector3(0, 1, 0);
  mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  return mesh;
}
function buildTruncatedFrustum(THREE, cfg) {
  const near = Math.max(0.01, cfg.near);
  const far  = Math.max(near + 0.01, cfg.far);
  const n = frustumDims(THREE, cfg.hFovDeg, (cfg.aspect || 16/9), near);
  const f = frustumDims(THREE, cfg.hFovDeg, (cfg.aspect || 16/9), far);
  const s = THREE.MathUtils.clamp((cfg.nearApertureScale || 1), 0.05, 1);
  const nHalfW = n.halfW * s, nHalfH = n.halfH * s;

  const group = new THREE.Group();

  const n0 = new THREE.Vector3(-nHalfW, -nHalfH, -near);
  const n1 = new THREE.Vector3( nHalfW, -nHalfH, -near);
  const n2 = new THREE.Vector3( nHalfW,  nHalfH, -near);
  const n3 = new THREE.Vector3(-nHalfW,  nHalfH, -near);

  const f0 = new THREE.Vector3(-f.halfW, -f.halfH, -far);
  const f1 = new THREE.Vector3( f.halfW, -f.halfH, -far);
  const f2 = new THREE.Vector3( f.halfW,  f.halfH, -far);
  const f3 = new THREE.Vector3(-f.halfW,  f.halfH, -far);

  const edgeMat = new THREE.MeshBasicMaterial({
    color: (cfg.fovColor != null ? cfg.fovColor : 0x00ff00),
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });

  group.add(tubeBetween(THREE, n0, f0, (cfg.edgeRadius || 0.016), edgeMat));
  group.add(tubeBetween(THREE, n1, f1, (cfg.edgeRadius || 0.016), edgeMat));
  group.add(tubeBetween(THREE, n2, f2, (cfg.edgeRadius || 0.016), edgeMat));
  group.add(tubeBetween(THREE, n3, f3, (cfg.edgeRadius || 0.016), edgeMat));

  group.add(tubeBetween(THREE, n0, n1, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, n1, n2, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, n2, n3, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, n3, n0, (cfg.baseEdgeRadius || 0.010), edgeMat));

  group.add(tubeBetween(THREE, f0, f1, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, f1, f2, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, f2, f3, (cfg.baseEdgeRadius || 0.010), edgeMat));
  group.add(tubeBetween(THREE, f3, f0, (cfg.baseEdgeRadius || 0.010), edgeMat));

  // faces (single BufferGeometry to keep it cheap)
  const pos = [];
  const quads = [[n0,n1,f1,f0],[n1,n2,f2,f1],[n2,n3,f3,f2],[n3,n0,f0,f3]];
  for (let i=0;i<quads.length;i++){
    const [a,b,c,d] = quads[i];
    pos.push(a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z);
    pos.push(a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z);
  }
  pos.push(n0.x,n0.y,n0.z, n1.x,n1.y,n1.z, n2.x,n2.y,n2.z);
  pos.push(n0.x,n0.y,n0.z, n2.x,n2.y,n2.z, n3.x,n3.y,n3.z);

  const faces = new THREE.BufferGeometry();
  faces.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const fillMat = new THREE.MeshBasicMaterial({
    color: (cfg.fovColor != null ? cfg.fovColor : 0x00ff00),
    transparent: true,
    opacity: (cfg.fillOpacity != null ? cfg.fillOpacity : 0.08),
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const mesh = new THREE.Mesh(faces, fillMat);
  group.add(mesh);

  group.userData = { nearRect: [n0,n1,n2,n3], farRect: [f0,f1,f2,f3] };
  return group;
}

/* ============ Stylized camera body (cafeteria) ============ */
function makeSideDecalTexture(THREE) {
  const w = 512, h = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = '#bfe6f0'; ctx.fillRect(0,0,w,Math.round(h*0.62));
  ctx.fillStyle = '#f59e0b';
  ctx.beginPath(); ctx.moveTo(70,0); ctx.lineTo(118,0); ctx.lineTo(54,h); ctx.lineTo(6,h); ctx.closePath(); ctx.fill();
  ctx.fillStyle = CFG.camText; ctx.font = 'bold 38px system-ui, Arial, sans-serif';
  ctx.textBaseline = 'middle'; ctx.fillText(BRAND_NAME, 160, Math.round(h*0.38));
  const tex = new THREE.CanvasTexture(c); tex.anisotropy = 8; tex.needsUpdate = true;
  return tex;
}
function buildStylizedCamera(THREE) {
  const g = new THREE.Group();
  const L = 0.44, wBack = 0.26, hBack = 0.16, wFront = 0.20, hFront = 0.13;
  const zF = -L/2, zB = L/2;
  const quad = (a,b,c,d,mat) => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array([
      a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z, a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z
    ]),3));
    return new THREE.Mesh(geom, mat);
  };
  const mWhite = new THREE.MeshLambertMaterial({ color: 0xeeeeee });
  const mBlue  = new THREE.MeshLambertMaterial({ color: 0xbfe6f0 });
  const mDecal = new THREE.MeshBasicMaterial({ map: makeSideDecalTexture(THREE) });

  g.add(quad(new THREE.Vector3(-wFront/2,-hFront/2,zF), new THREE.Vector3(wFront/2,-hFront/2,zF),
             new THREE.Vector3(wFront/2,hFront/2,zF),  new THREE.Vector3(-wFront/2,hFront/2,zF), mWhite));
  g.add(quad(new THREE.Vector3(-wBack/2,-hBack/2,zB),  new THREE.Vector3(wBack/2,-hBack/2,zB),
             new THREE.Vector3(wBack/2,hBack/2,zB),   new THREE.Vector3(-wBack/2,hBack/2,zB),  mWhite));
  g.add(quad(new THREE.Vector3(-wBack/2,hBack/2,zB),   new THREE.Vector3(wBack/2,hBack/2,zB),
             new THREE.Vector3(wFront/2,hFront/2,zF),  new THREE.Vector3(-wFront/2,hFront/2,zF), mBlue));
  g.add(quad(new THREE.Vector3(-wBack/2,-hBack/2,zB),  new THREE.Vector3(wBack/2,-hBack/2,zB),
             new THREE.Vector3(wFront/2,-hFront/2,zF), new THREE.Vector3(-wFront/2,-hFront/2,zF), mWhite));
  g.add(quad(new THREE.Vector3(wBack/2,-hBack/2,zB),   new THREE.Vector3(wBack/2,hBack/2,zB),
             new THREE.Vector3(wFront/2,hFront/2,zF),  new THREE.Vector3(wFront/2,-hFront/2,zF), mWhite));

  // left decal
  {
    const a = new THREE.Vector3(-wBack/2,-hBack/2, zB);
    const b = new THREE.Vector3(-wBack/2, hBack/2, zB);
    const c = new THREE.Vector3(-wFront/2, hFront/2, zF);
    const d = new THREE.Vector3(-wFront/2,-hFront/2, zF);
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array([
      a.x,a.y,a.z, b.x,b.y,b.z, c.x,c.y,c.z, a.x,a.y,a.z, c.x,c.y,c.z, d.x,d.y,d.z
    ]),3));
    geom.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array([0,1, 0,0, 1,0, 0,1, 1,0, 1,1]),2));
    g.add(new THREE.Mesh(geom, mDecal));
  }

  // details
  const lip = new THREE.Mesh(new THREE.BoxGeometry((wBack+wFront)/2*0.98, 0.014, L*0.88),
                             new THREE.MeshLambertMaterial({ color: 0xffffff }));
  lip.position.y = -Math.min(hBack,hFront)*0.40; lip.position.z = -L*0.05; g.add(lip);

  const bezel = new THREE.Mesh(new THREE.RingGeometry(0.058, 0.082, 32),
                               new THREE.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.95 }));
  bezel.rotation.y = Math.PI; bezel.position.z = zF - 0.002; g.add(bezel);

  const housing = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.022, 24),
                                 new THREE.MeshLambertMaterial({ color: 0x222222 }));
  housing.rotation.x = Math.PI/2; housing.rotation.z = Math.PI/2; housing.position.z = zF - 0.018; g.add(housing);

  const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.055, 24),
                              new THREE.MeshBasicMaterial({ color: 0x76ff76, transparent:true, opacity:0.35 }));
  lens.rotation.x = Math.PI/2; lens.rotation.z = Math.PI/2; lens.position.z = zF - 0.045; g.add(lens);

  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.04, 18, 14),
                              new THREE.MeshBasicMaterial({ color: 0x66ff66, transparent:true, opacity:0.28 }));
  glow.position.z = zF - 0.028; g.add(glow);

  // arm + mount
  const white = new THREE.MeshLambertMaterial({ color: CFG.camWhite });
  const hinge = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.06), white);
  hinge.position.set(0, -hBack*0.60, -L*0.12); g.add(hinge);

  const arm1 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 16), white);
  arm1.rotation.z = -0.35; arm1.position.set(0.06, -hBack*0.95, -L*0.14); g.add(arm1);

  const joint = new THREE.Mesh(new THREE.SphereGeometry(0.022, 16, 12), white);
  joint.position.set(0.11, -hBack*1.15, -L*0.12); g.add(joint);

  const arm2 = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.22, 16), white);
  arm2.rotation.z = 0.25; arm2.position.set(0.17, -hBack*1.30, -L*0.10); g.add(arm2);

  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.012, 24), white);
  base.position.set(0.20, -hBack*1.40, -L*0.08); g.add(base);

  const curve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(0.00, -hBack*0.30, -L*0.12),
    new THREE.Vector3(0.08, -hBack*0.95, -L*0.14),
    new THREE.Vector3(0.20, -hBack*1.37, -L*0.08)
  );
  const tube = new THREE.TubeGeometry(curve, 18, 0.0045, 10, false);
  const cable = new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ color: CFG.cableBlack }));
  g.add(cable);

  return g;
}

/* =========== FOV-only rig (for outdoor cameras) =========== */
function makeFovOnlyRig(THREE, sceneObject, cfg, color) {
  const node = sceneObject.addNode();
  node.obj3D.visible = true; // outdoor visible by default (we'll gate Admin by room later)

  const pan = new THREE.Object3D();
  const tilt = new THREE.Object3D();
  pan.add(tilt); node.obj3D.add(pan);

  node.obj3D.position.set(cfg.position.x, cfg.position.y, cfg.position.z);
  pan.rotation.y  = deg2rad(cfg.yawDeg || 0);
  tilt.rotation.x = -deg2rad(cfg.tiltDeg || 10);

  const frustum = buildTruncatedFrustum(THREE, { ...CFG, ...cfg, fovColor: (color != null ? color : CFG.fovColor) });
  tilt.add(frustum);

  // projector mesh
  // projector mesh
  const u = PERF.OUTDOOR_GRID.u, v = PERF.OUTDOOR_GRID.v;
  const tris = (u-1)*(v-1)*2;
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tris*9), 3));
  const mat = new THREE.MeshBasicMaterial({
    color: (color != null ? color : CFG.fovColor),
    transparent: true,
    opacity: CFG.footprintOpacity,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const projector = new THREE.Mesh(geom, mat);
  node.obj3D.add(projector);

  return { node, pan, tilt, frustum, projector, projectorU: u, projectorV: v };
}

/* ============================= UI ============================= */
function makePanel(selectedId) {
  const old = document.getElementById('fov-panel'); if (old) old.remove();

  const wrap = document.createElement('div');
  wrap.id = 'fov-panel';
  wrap.style.cssText =
    'position:fixed;right:12px;bottom:12px;z-index:2147483647;background:rgba(0,0,0,.68);' +
    'color:#fff;padding:12px;border-radius:12px;font:14px/1.15 system-ui,Arial;width:240px;box-shadow:0 6px 18px rgba(0,0,0,.35);';
  document.body.appendChild(wrap);

  const title = document.createElement('div');
  title.style.cssText='font-weight:700;margin-bottom:8px;text-align:center;';
  title.textContent = PANEL_TITLE;
  wrap.appendChild(title);

  const pick = document.createElement('select');
  pick.style.cssText='width:100%;margin:0 0 8px 0;padding:6px;border-radius:8px;border:none;';
  rigs.forEach(r => {
    const o = document.createElement('option');
    o.value = r.id; o.textContent = r.label || r.id;
    if (selectedId && r.id === selectedId) o.selected = true;
    pick.appendChild(o);
  });
  wrap.appendChild(pick);

  const grid = document.createElement('div');
  grid.style.cssText = 'display:grid;grid-template-columns:1fr auto auto;gap:8px;';
  wrap.appendChild(grid);

  const valLine = (text) => {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.cssText='grid-column:1 / span 3;text-align:center;font-weight:700;';
    grid.appendChild(d);
    return d;
  };

  function mountControls(rig) {
    grid.innerHTML = '';
    const cfg = rig.cfg;

    const row = (label, get, set, step, unit, min, max, decimals) => {
      decimals = (decimals == null ? 0 : decimals);
      const name = document.createElement('div'); name.textContent=label; name.style.cssText='align-self:center;';
      const mk=(txt,delta)=>{
        const b=document.createElement('button'); b.textContent=txt;
        b.style.cssText='background:#14b8a6;border:none;color:#001;font-weight:800;border-radius:10px;padding:8px 10px;cursor:pointer;';
        b.onclick=(e)=>{
          e.preventDefault();
          const v = clamp(+((get()+delta).toFixed(decimals)), min, max);
          set(v);
          val.textContent = get().toFixed(decimals) + unit;
        };
        return b;
      };
      const minus=mk('−',-step), plus=mk('+',step);
      const val = valLine(get().toFixed(decimals) + unit);
      grid.appendChild(name); grid.appendChild(minus); grid.appendChild(plus);
    };

    // shared optics
    row('HFOV',  ()=>cfg.hFovDeg, v=>{cfg.hFovDeg=v; rig.rebuild();}, 1,'°',10,120);
    row('NEAR',  ()=>cfg.near,    v=>{cfg.near=v;    rig.rebuild();}, 0.01,'',0.02,1,2);
    row('FAR',   ()=>cfg.far,     v=>{cfg.far=v;     rig.rebuild();}, 1,'',2,120);

    if (rig.type === 'indoor' || rig.type === 'admin-pan') {
      // panning rigs
      row('SWEEP', ()=>cfg.sweepDeg,   v=>{cfg.sweepDeg=v;}, 2,'°',4,170);
      row('YawSpd',()=>cfg.yawSpeedDeg||10, v=>{cfg.yawSpeedDeg=v;}, 1,'°/s',1,60);
      row('YAW',   ()=>cfg.baseYawDeg ?? cfg.yawDeg ?? 0,
                  v=>{ if('baseYawDeg'in cfg) cfg.baseYawDeg=v; else {cfg.yawDeg=v; rig.refs.pan.rotation.y=deg2rad(v);} },
                  1,'°',-180,180);
      row('TILT',  ()=>cfg.tiltDeg||10,  v=>{cfg.tiltDeg=v; rig.applyTilt();}, 1,'°',0,85);
    } else {
      // Outdoor fixed rigs
      row('YAW',   ()=>cfg.yawDeg || 0,  v=>{ cfg.yawDeg=v; rig.refs.pan.rotation.y = deg2rad(v); }, 1,'°',-180,180);
      row('TILT',  ()=>cfg.tiltDeg||10,  v=>{ cfg.tiltDeg=v; rig.applyTilt(); }, 1,'°',0,85);
    }
  }

  let current = rigs.get(selectedId) || rigs.values().next().value;
  if (current) mountControls(current);
  pick.onchange = () => { current = rigs.get(pick.value); if (current) mountControls(current); };

  const footer=document.createElement('div'); footer.style.cssText='display:flex;gap:8px;margin-top:10px;';
  const hide=document.createElement('button'); hide.textContent='Hide';
  hide.style.cssText='flex:1;background:#64748b;border:none;border-radius:10px;padding:10px;color:#fff;font-weight:800;';
  hide.onclick=(e)=>{e.preventDefault(); wrap.style.display = (wrap.style.display==='none')?'block':'none'; };
  footer.appendChild(hide); wrap.appendChild(footer);

  return { wrap, pick };
}
window._makePanel = makePanel;

/* ============================ Main ============================ */
const main = async () => {
  const viewer = document.querySelector('matterport-viewer');
  if (viewer) viewer.setAttribute('asset-base', ASSET_BASE);
  window.MP_SDK_CONFIG = { assetBase: ASSET_BASE };

  const mpSdk = await viewer.playingPromise;
  const THREE = window.THREE;

  await mpSdk.Mode.moveTo(mpSdk.Mode.Mode.INSIDE);

  const [sceneObject] = await mpSdk.Scene.createObjects(1);

  const rootNode = sceneObject.addNode();
  rootNode.obj3D.visible = false;

  // lights for stylized head
  const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 0.6);
  const dir  = new THREE.DirectionalLight(0xffffff, 0.5);
  dir.position.set(1, 2, 1);
  rootNode.obj3D.add(hemi, dir);

  /* -------- Cafeteria rig (stylized) -------- */
  const panPivot  = new THREE.Object3D();
  const tiltPivot = new THREE.Object3D();
  panPivot.add(tiltPivot); rootNode.obj3D.add(panPivot);
  rootNode.obj3D.position.set(CFG.position.x, CFG.position.y, CFG.position.z);

  const head = buildStylizedCamera(THREE);
  tiltPivot.add(head);

  let frustumGroup = buildTruncatedFrustum(THREE, CFG);
  tiltPivot.add(frustumGroup);

  const applyTilt = () => { tiltPivot.rotation.x = -deg2rad(CFG.tiltDeg); };
  applyTilt();

  // indoor projector
const projector = {
  u: PERF.INDOOR_GRID.u, v: PERF.INDOOR_GRID.v,
  geom: new THREE.BufferGeometry(),
  mat:  new THREE.MeshBasicMaterial({
    color: CFG.fovColor, transparent: true, opacity: CFG.footprintOpacity,
    side: THREE.DoubleSide, depthTest: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1
  }),
  mesh: null,
};
  (function initProjector(){
    const tris  = (projector.u-1)*(projector.v-1)*2;
    projector.geom.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(tris*9), 3));
    projector.mesh = new THREE.Mesh(projector.geom, projector.mat);
    rootNode.obj3D.add(projector.mesh);
  })();

  // register cafeteria rig
  const cafeteriaCfg = { hFovDeg: CFG.hFovDeg, near: CFG.near, far: CFG.far, maxDistanceM: 25,
                         sweepDeg: CFG.sweepDeg, baseYawDeg: CFG.baseYawDeg, yawSpeedDeg: CFG.yawSpeedDeg, tiltDeg: CFG.tiltDeg };
  registerRig({
    id: 'cafeteria',
    label: 'Ark Cafeteria Cam',
    type: 'indoor',
    cfg: cafeteriaCfg,
    refs: { panPivot, tiltPivot, pan: panPivot, frustum: () => frustumGroup },
    rebuild: () => {
      tiltPivot.remove(frustumGroup);
      if (frustumGroup && frustumGroup.traverse) {
        frustumGroup.traverse(o => { o.geometry && o.geometry.dispose && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); });
      }
      Object.assign(CFG, { hFovDeg: cafeteriaCfg.hFovDeg, near: cafeteriaCfg.near, far: cafeteriaCfg.far });
      frustumGroup = buildTruncatedFrustum(THREE, CFG);
      tiltPivot.add(frustumGroup);
      updateVisibility(true);
    },
    applyTilt: () => applyTilt(),
  });

  // start cafeteria node + panel immediately
  rootNode.start();
  makePanel('cafeteria');

  /* -------- Outdoor rigs from Mattertags -------- */

  // Admin Office: we'll detect by label and convert this rig to "admin-pan"
  // All others are "outdoor" fixed rigs with presets applied by label.

  // Your supplied presets for outdoor cams (except Admin)
  const CAM_PRESETS = {
    byLabel: {
      "Security Camera 1600 BLDG - Near Room 16-006": { hFovDeg: 35, near: 0.03, far: 15, yawDeg: -167, tiltDeg: 13 },
      "Security Camera - 2-017 Outside":               { hFovDeg: 27, near: 0.12, far: 18, yawDeg: 11,   tiltDeg: 13 },
      "Security Camera 1600 BLDG - Near Room 16-003":  { hFovDeg: 32, near: 0.03, far: 22, yawDeg: 126,  tiltDeg: 10 },
      "Security Camera - 1500 BLDG - near room 15-005":{ hFovDeg: 19, near: 0.12, far: 20, yawDeg: -96,  tiltDeg: 7  },
      "Security Camera 1600 BLDG - Near Room 16-008":  { hFovDeg: 30, near: 0.09, far: 21, yawDeg: -12,  tiltDeg: 12 },
      "Security Camera 1600 BLDG - Near Room 16-014":  { hFovDeg: 29, near: 0.05, far: 20, yawDeg: 8,    tiltDeg: 12 },
      "Security Camera 1600 BLDG - Near Room 16-009":  { hFovDeg: 26, near: 0.05, far: 22, yawDeg: 171,  tiltDeg: 12 },
      "Security Camera - 200 BLDG - Near Room 2017":   { hFovDeg: 21, near: 0.04, far: 22, yawDeg: -96,  tiltDeg: 11 },
      "Security Camera 1500 BLDG - Near Room 15-006":  { hFovDeg: 31, near: 0.12, far: 22, yawDeg: -78,  tiltDeg: 10 },
      // Admin Office handled separately
    },
    defaultOutdoor: { hFovDeg: 32, near: 0.12, far: 22, yawDeg: 0, tiltDeg: 10 },
  };

  function pickNum(text, re, d) {
    const m = text && text.match ? text.match(re) : null;
    return m ? parseFloat(m[1]) : d;
  }
  function parseOutdoorCfgFromTag(tag) {
    const label = (tag.label || '');
    const desc  = (tag.description || '');
    const txt = label + '\n' + desc;
    return {
      position: { x: tag.anchorPosition.x, y: tag.anchorPosition.y, z: tag.anchorPosition.z },
      hFovDeg:  pickNum(txt, /\bhfov\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 32),
      near:     pickNum(txt, /\bnear\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 0.12),
      far:      pickNum(txt, /\bfar\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 22),
      yawDeg:   pickNum(txt, /\byaw\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 0),
      tiltDeg:  pickNum(txt, /\btilt\s*[:=]\s*(-?\d+(?:\.\d+)?)/i, 10),
      maxDistanceM: 9999, // outdoor: always visible (no max distance gate)
      aspect: 16/9,
    };
  }

  async function getTagsWithTimeout(ms) {
    ms = (ms || 1500);
    try {
      if (mpSdk.Tag && mpSdk.Tag.data && mpSdk.Tag.data.subscribe) {
        const tagDataPromise = new Promise(resolve => {
          const unsub = mpSdk.Tag.data.subscribe(tags => {
            try {
              let arr = [];
              if (Array.isArray(tags)) arr = tags;
              else if (tags && typeof tags.toArray === 'function') arr = tags.toArray();
              else if (tags) arr = Object.values(tags);
              if (arr) { unsub && unsub(); resolve(arr); }
            } catch (e) { unsub && unsub(); resolve([]); }
          });
        });
        const timeout = new Promise(resolve => setTimeout(() => resolve(null), ms));
        const viaNew = await Promise.race([tagDataPromise, timeout]);
        if (viaNew) return viaNew;
      }
    } catch (e) {}
    try { return await mpSdk.Mattertag.getData(); } catch (e) { return []; }
  }

  async function initOutdoorGround(rig) {
    try {
      const origin = rig.node.obj3D.getWorldPosition(new THREE.Vector3());
      const hit = await mpSdk.Scene.raycast(
        { x: origin.x, y: origin.y, z: origin.z },
        { x: 0, y: -1, z: 0 },
        60
      );
      rig.groundY = (hit && hit.hit) ? hit.position.y : 0.0;
    } catch { rig.groundY = 0.0; }
  }

  const outdoorEntries = [];   // keep for updates / throttling
  const adminEntries   = [];   // panning outdoor rigs (Admin)

  function applyLabelPreset(label, cfg) {
    const p = CAM_PRESETS.byLabel[label];
    if (p) Object.assign(cfg, p);
    else Object.assign(cfg, CAM_PRESETS.defaultOutdoor);
  }

  async function spawnOutdoorCamsFromTags() {
    const tags = await getTagsWithTimeout();
    const camTags = tags.filter(t => OUTDOOR_TAG_MATCH.test(t.label || ''));
    for (let i=0;i<camTags.length;i++) {
      const t = camTags[i];
      const isAdmin = (t.label === ADMIN_LABEL);
      const baseCfg = parseOutdoorCfgFromTag(t);

      if (isAdmin) { Object.assign(baseCfg, ADMIN_DEFAULTS); }
      else { applyLabelPreset(t.label, baseCfg); }

      const rig = makeFovOnlyRig(THREE, sceneObject, baseCfg, CFG.fovColor);
      await initOutdoorGround(rig);
      rig.node.start();

      // try to capture the tag's room id if present in any common property
      const roomId = t.roomId || t.room || t.anchorRoom || (t.roomInfo && t.roomInfo.id) || null;

      const id = (t.sid || ('out-' + (i+1)));
      const label = (t.label || ('Outdoor ' + (i+1)));

      const entry = {
        id, label,
        type: isAdmin ? 'admin-pan' : 'outdoor',
        cfg: baseCfg,
        refs: {
          node: rig.node, pan: rig.pan, tilt: rig.tilt,
          frustum: () => rig.frustum,
          projector: rig.projector,
          projectorU: rig.projectorU, projectorV: rig.projectorV,
          get groundY(){ return rig.groundY; },
        },
        roomId: roomId,
        rebuild: () => {
          const parent = rig.tilt;
          parent.remove(rig.frustum);
          if (rig.frustum && rig.frustum.traverse) {
            rig.frustum.traverse(o => { o.geometry && o.geometry.dispose && o.geometry.dispose(); o.material && o.material.dispose && o.material.dispose(); });
          }
          rig.frustum = buildTruncatedFrustum(THREE, { ...CFG, ...baseCfg });
          parent.add(rig.frustum);
        },
        applyTilt: () => { rig.tilt.rotation.x = -deg2rad(baseCfg.tiltDeg || 10); },
      };

      registerRig(entry);
      if (isAdmin) adminEntries.push(entry); else outdoorEntries.push(entry);

      // add to UI
      try {
        const pick = document.querySelector('#fov-panel select');
        if (pick) {
          let exists = false;
          for (let j=0;j<pick.options.length;j++) if (pick.options[j].value === id) { exists = true; break; }
          if (!exists) {
            const o = document.createElement('option');
            o.value = id; o.textContent = label;
            pick.appendChild(o);
          }
        }
      } catch (e) {}
    }
    log('Spawned outdoor rigs:', outdoorEntries.length, 'admin(pan):', adminEntries.length);
  }
  spawnOutdoorCamsFromTags().catch(e => console.warn('[SECAM] outdoor spawn error', e));

  /* --------------- Visibility + projectors (throttled) --------------- */
  const viewerPos = new THREE.Vector3();
  let lastPose = { p: new THREE.Vector3(0,0,0), t: performance.now(), yawRad: 0 };
  function poseChangedEnough(p) {
    const moved = p.position && Math.hypot(p.position.x - lastPose.p.x, p.position.y - lastPose.p.y, p.position.z - lastPose.p.z) > PERF.MIN_MOVE;
    // estimate yaw from forward (z axis of camera in world). If not provided, rely on movement.
    let yawChanged = false;
    try {
      if (p.rotation && Array.isArray(p.rotation)) {
        const yaw = p.rotation[1]; // best effort (SDK uses [x,y,z,w]? varies)
        if (typeof yaw === 'number') {
          const deg = Math.abs((yaw - lastPose.yawRad) * 180/Math.PI);
          yawChanged = deg > PERF.MIN_YAW_DEG;
        }
      }
    } catch {}
    return moved || yawChanged;
  }
  mpSdk.Camera.pose.subscribe(p => {
    viewerPos.set(p.position.x, p.position.y, p.position.z);
    if (poseChangedEnough(p)) {
      lastPose.p.set(p.position.x, p.position.y, p.position.z);
      if (p.rotation && Array.isArray(p.rotation)) lastPose.yawRad = p.rotation[1];
      updateVisibility(false, true); // fast path
    }
  });

  let mode = mpSdk.Mode.Mode.INSIDE;
  mpSdk.Mode.current.subscribe(m => { mode = m; updateVisibility(true); });

  // Room.current (for cafeteria gating + Admin Office gating)
  let currentRooms = new Set();
  mpSdk.Room.current.subscribe((payload) => {
    try {
      let list = [];
      if (Array.isArray(payload)) list = payload;
      else if (payload && typeof payload[Symbol.iterator] === 'function') list = Array.from(payload);
      else if (payload && Array.isArray(payload.ids)) list = payload.ids;
      currentRooms = new Set(list);
      updateVisibility(true);
    } catch (err) {}
  });

  let currentSweepRoomId = null;
  mpSdk.Sweep.current.subscribe((sw) => {
    currentSweepRoomId = (sw && sw.roomInfo ? sw.roomInfo.id : null);
    updateVisibility(true);
  });

  async function raycastFirst(origin, direction, maxDist) {
    try {
      if (mpSdk.Scene && typeof mpSdk.Scene.raycast === 'function') {
        return await mpSdk.Scene.raycast(
          { x: origin.x, y: origin.y, z: origin.z },
          { x: direction.x, y: direction.y, z: direction.z },
          maxDist
        );
      }
    } catch (_) {}
    return null;
  }

  async function updateVisibility(force=false) {
    // Floorplan always allowed for cafeteria rig
    if (mode === mpSdk.Mode.Mode.FLOORPLAN && SHOW_IN_FLOORPLAN) {
      rootNode.obj3D.visible = true;
    } else {
      // room / sweep gating for cafeteria
      let inTargetRoom = true;
      if (USE_SWEEP_GATE && currentSweepRoomId) {
        inTargetRoom = (currentSweepRoomId === BOUND_ROOM_ID);
      } else if (USE_ROOM_GATE) {
        inTargetRoom = currentRooms.has(BOUND_ROOM_ID);
      }
      if (!inTargetRoom) { rootNode.obj3D.visible = false; } else {
        rootNode.obj3D.visible = true;
      }
    }

    // Admin Office: confine to its room (if detectable)
    for (const entry of adminEntries) {
      if (!entry.roomId) { entry.refs.node.obj3D.visible = true; continue; }
      const same = currentRooms.has(entry.roomId);
      entry.refs.node.obj3D.visible = same;
    }
  }

  // ---------- Projector updaters (throttled & no normals) ----------
  let lastIndoorSolve = 0;
  async function updateProjector(now) {
    if (!rootNode.obj3D.visible) { projector.mesh.visible = false; return; }
    if (now - lastIndoorSolve < PERF.PROJECTOR_MIN_DT) return;
    lastIndoorSolve = now;

    const nearRect = frustumGroup.userData.nearRect;
    const farRect  = frustumGroup.userData.farRect;
    const u = projector.u, v = projector.v;

    const nearGrid = [], farGrid = [];
    for (let yi=0; yi<v; yi++){
      const ty = yi/(v-1);
      const nA = new THREE.Vector3().lerpVectors(nearRect[0], nearRect[3], ty);
      const nB = new THREE.Vector3().lerpVectors(nearRect[1], nearRect[2], ty);
      const fA = new THREE.Vector3().lerpVectors(farRect[0],  farRect[3],  ty);
      const fB = new THREE.Vector3().lerpVectors(farRect[1],  farRect[2],  ty);
      for (let xi=0; xi<u; xi++){
        const tx = xi/(u-1);
        nearGrid.push(new THREE.Vector3().lerpVectors(nA, nB, tx));
        farGrid .push(new THREE.Vector3().lerpVectors(fA, fB, tx));
      }
    }

    const worldPts = new Array(nearGrid.length);
    for (let i=0;i<nearGrid.length;i++){
      const nW = tiltPivot.localToWorld(nearGrid[i].clone());
      const fW = tiltPivot.localToWorld(farGrid[i].clone());
      const dir = new THREE.Vector3().subVectors(fW, nW);
      const len = dir.length(); if (len <= 1e-4) { projector.mesh.visible=false; return; }
      dir.normalize();

      let hit = null;
      try { hit = await mpSdk.Scene.raycast({ x:nW.x, y:nW.y, z:nW.z }, { x:dir.x, y:dir.y, z:dir.z }, len); } catch(_){}

      if (hit && hit.hit) {
        worldPts[i] = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
      } else {
        const t = ((CFG.floorY || 0) - nW.y) / (fW.y - nW.y);
        if (!(t >= 0 && t <= 1 && isFinite(t))) { projector.mesh.visible = false; return; }
        worldPts[i] = new THREE.Vector3().copy(nW).addScaledVector(new THREE.Vector3().subVectors(fW, nW), t);
      }
    }
    projector.mesh.visible = true;

    const arr = projector.geom.attributes.position.array;
    let k = 0;
    for (let yi=0; yi<v-1; yi++){
      for (let xi=0; xi<u-1; xi++){
        const idx = yi*u + xi;
        const p00 = rootNode.obj3D.worldToLocal(worldPts[idx    ].clone());
        const p10 = rootNode.obj3D.worldToLocal(worldPts[idx + 1].clone());
        const p01 = rootNode.obj3D.worldToLocal(worldPts[idx + u].clone());
        const p11 = rootNode.obj3D.worldToLocal(worldPts[idx + u + 1].clone());
        const write = (p)=>{ arr[k++]=p.x; arr[k++]=p.y+0.003; arr[k++]=p.z; };
        write(p00); write(p10); write(p11);
        write(p00); write(p11); write(p01);
      }
    }
    projector.geom.attributes.position.needsUpdate = true;
  }

  // Outdoor projector solve (per entry, throttled)
  const outdoorSolveState = new Map(); // id -> { last: ms, inFlight: bool }
  async function updateOutdoorProjector(entry, now) {
    const rig = entry.refs;
    if (!rig || !rig.node || !rig.frustum) return;
    if (!rig.node.obj3D.visible) { if (rig.projector) rig.projector.visible = false; return; }

    const st = outdoorSolveState.get(entry.id) || { last: 0, inFlight: false };
    if (st.inFlight || (now - st.last) < PERF.OUTDOOR_MIN_DT) return;
    st.inFlight = true; outdoorSolveState.set(entry.id, st);

    const frustum = (typeof rig.frustum === 'function' ? rig.frustum() : rig.frustum);
    if (!frustum) { st.inFlight=false; return; }

    const nearRect = frustum.userData.nearRect;
    const farRect  = frustum.userData.farRect;
    const u = rig.projectorU || PERF.U, v = rig.projectorV || PERF.V;

    const nearGrid = [], farGrid = [];
    for (let yi=0; yi<v; yi++){
      const ty = yi/(v-1);
      const nA = new THREE.Vector3().lerpVectors(nearRect[0], nearRect[3], ty);
      const nB = new THREE.Vector3().lerpVectors(nearRect[1], nearRect[2], ty);
      const fA = new THREE.Vector3().lerpVectors(farRect[0],  farRect[3],  ty);
      const fB = new THREE.Vector3().lerpVectors(farRect[1],  farRect[2],  ty);
      for (let xi=0; xi<u; xi++){
        const tx = xi/(u-1);
        nearGrid.push(new THREE.Vector3().lerpVectors(nA, nB, tx));
        farGrid .push(new THREE.Vector3().lerpVectors(fA, fB, tx));
      }
    }

    const worldPts = new Array(nearGrid.length);
    let filled = 0;
    for (let i=0;i<nearGrid.length;i++){
      const nW = rig.tilt.localToWorld(nearGrid[i].clone());
      const fW = rig.tilt.localToWorld(farGrid[i].clone());
      const seg = new THREE.Vector3().subVectors(fW, nW);
      const len = seg.length(); if (len <= 1e-4) continue;
      const dir = seg.clone().normalize();

      let hit = null;
      try { hit = await mpSdk.Scene.raycast({ x:nW.x, y:nW.y, z:nW.z }, { x:dir.x, y:dir.y, z:dir.z }, len); } catch(_){}

      let wp = null;
      if (hit && hit.hit) {
        wp = new THREE.Vector3(hit.position.x, hit.position.y, hit.position.z);
      } else {
        const floorY = (rig.groundY != null ? rig.groundY : 0.0);
        const t = (floorY - nW.y) / (fW.y - nW.y);
        if (isFinite(t) && t >= 0 && t <= 1) {
          wp = nW.clone().addScaledVector(seg, t);
        }
      }
      if (wp) { worldPts[i] = wp; filled++; }
    }

    const geo = rig.projector.geometry;
    const pos = geo.attributes.position.array;
    let k = 0;
    for (let yi=0; yi<v-1; yi++){
      for (let xi=0; xi<u-1; xi++){
        const idx = yi*u + xi;
        const p00 = worldPts[idx];
        const p10 = worldPts[idx + 1];
        const p01 = worldPts[idx + u];
        const p11 = worldPts[idx + u + 1];
        if (!p00 || !p10 || !p01 || !p11) continue;

        const toLocal = p => rig.node.obj3D.worldToLocal(p.clone());
        const write = p => { pos[k++] = p.x; pos[k++] = p.y + 0.003; pos[k++] = p.z; };

        write(toLocal(p00)); write(toLocal(p10)); write(toLocal(p11));
        write(toLocal(p00)); write(toLocal(p11)); write(toLocal(p01));
      }
    }
    for (let i=k;i<pos.length;i++) pos[i]=0;

    rig.projector.visible = (k !== 0 && filled !== 0);
    geo.attributes.position.needsUpdate = true;

    st.last = now; st.inFlight = false; outdoorSolveState.set(entry.id, st);
  }

  // animate cafeteria sweep + projectors + admin pan
  let phaseIndoor = 0, last = performance.now();
  const adminPhase = new Map(); // id -> phase
  function animate(now) {
    const dt = (now - last)/1000; last = now;

    // cafeteria sweep
    const yawCenter = deg2rad(cafeteriaCfg.baseYawDeg);
    const yawAmp    = deg2rad(cafeteriaCfg.sweepDeg) * 0.5;
    const yawSpeed  = deg2rad(cafeteriaCfg.yawSpeedDeg);
    phaseIndoor += yawSpeed * dt;
    panPivot.rotation.y = yawCenter + Math.sin(phaseIndoor) * yawAmp;

    // Admin Office rigs (pan in place, confined by room via visibility)
    for (const entry of adminEntries) {
      const cfg = entry.cfg, pan = entry.refs.pan;
      const center = deg2rad(cfg.yawDeg || 0);
      const amp    = deg2rad(cfg.sweepDeg || 0) * 0.5;
      const spd    = deg2rad(cfg.yawSpeedDeg || 10);
      const ph = (adminPhase.get(entry.id) || 0) + spd * dt;
      adminPhase.set(entry.id, ph);
      pan.rotation.y = center + Math.sin(ph) * amp;
    }

    // Throttled solves
    updateProjector(now);
    for (const entry of outdoorEntries.concat(adminEntries)) updateOutdoorProjector(entry, now);

    requestAnimationFrame(animate);
  }
  requestAnimationFrame(animate);

  // first visibility pass
  updateVisibility(true);
};

main().catch(console.error);