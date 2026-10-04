// DON'T WAKE THE GIANT — gameplay prototype (Three.js, no build step)
(() => {
'use strict';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const damp = (a, b, k, dt) => lerp(a, b, 1 - Math.exp(-k * dt));
const ease = (t) => t * t * (3 - 2 * t);
const wrapAng = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- tuning
const CFG = {
  walk: 6, run: 10.5, panicRun: 12, jumpV: 9.5, gravity: 26, pr: 0.45, ph: 2.1, pickRange: 3.0,
  noise: {
    walk: 1.6,        // per second, x hearing
    run: 10,          // per second, x hearing
    jump: 6, land: 4, creak: 14,
    decay: 8,         // per second while quiet
    decayDelay: 0.45, // quiet time before decay starts
    hideMul: 2.4,     // decay multiplier while hidden
    watchMul: 2.5,    // movement noise multiplier while he is SUSPICIOUS
  },
  thr: { restless: 35, restlessOut: 27, susp: 70, suspOut: 60 },
  giant: { speed: 8, speedMax: 10.2, accel: 0.11, turn: 2.3, catchR: 4.6, grabR: 2.8 },
};
const ROOM = { x0: -28, x1: 28, z0: -42, z1: 40, h: 48 };
const EAR = new THREE.Vector3(0, 21, -36);   // the sleeping Giant's head
const EXIT = new THREE.Vector3(0, 0, 39.6);

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1530);
scene.fog = new THREE.Fog(0x1a1530, 80, 160);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 300);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- helpers
const matCache = new Map();
function M(color, o = {}) {
  const key = color + JSON.stringify(o);
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8 }, o)));
  return matCache.get(key);
}
const GOLD = M(0xffc928, { roughness: 0.3, metalness: 0.35, emissive: 0x7a4c00, emissiveIntensity: 0.7 });
const SILVER = M(0xe4ebf5, { roughness: 0.25, metalness: 0.3, emissive: 0x3a4250 });
const WOOD = M(0x8a5a34), DARKWOOD = M(0x5a3820), CREAM = M(0xf4ead2);

const solids = [];      // axis-aligned colliders {x0,x1,y0,y1,z0,z1}
const camBlockers = []; // meshes the camera should not pass through

function box(w, h, d, mat, x, y, z, parent = scene, opt = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof mat === 'number' ? M(mat) : mat);
  m.position.set(x, y, z);
  m.castShadow = opt.cast !== false; m.receiveShadow = true;
  parent.add(m);
  return m;
}
// furniture piece; y is the bottom
function block(w, h, d, mat, x, y, z, opt = {}) {
  const m = box(w, h, d, mat, x, y + h / 2, z, scene, opt);
  if (opt.solid) solids.push({ x0: x - w / 2, x1: x + w / 2, y0: y, y1: y + h, z0: z - d / 2, z1: z + d / 2 });
  if (opt.cam) camBlockers.push(m);
  return m;
}
function cyl(rt, rb, h, mat, x, y, z, seg = 12, parent = scene) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), typeof mat === 'number' ? M(mat) : mat);
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = 4;
  return t;
}
const glowTex = canvasTex(64, 64, (g) => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});
function glow(color, size, parent, opacity = 0.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.set(size, size, 1); parent.add(s); return s;
}
function textSprite(text, color, size, font = 'bold 90px Lilita One, Arial Black, sans-serif') {
  const t = canvasTex(256, 128, (g) => {
    g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineWidth = 12; g.strokeStyle = '#000'; g.strokeText(text, 128, 66);
    g.fillStyle = color; g.fillText(text, 128, 66);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(size * 2, size, 1); return s;
}

// ---------------------------------------------------------------- lights
scene.add(new THREE.HemisphereLight(0xcdd8ff, 0x6b4a3a, 0.72));
const moon = new THREE.DirectionalLight(0xb0c4ff, 0.62);
moon.position.set(-45, 70, 25); moon.castShadow = true;
moon.shadow.mapSize.set(2048, 2048);
Object.assign(moon.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 200 });
moon.shadow.bias = -0.0006; moon.shadow.normalBias = 0.04;
scene.add(moon);
const warmFill = new THREE.DirectionalLight(0xffb070, 0.28); warmFill.position.set(30, 40, 40); scene.add(warmFill);

const candles = [];
function candle(x, y, z, s = 1) {
  cyl(0.9 * s, 1.0 * s, 0.3 * s, GOLD, x, y + 0.15 * s, z);
  cyl(0.55 * s, 0.6 * s, 2.6 * s, CREAM, x, y + 1.6 * s, z, 10);
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.28 * s, 0.9 * s, 6),
    new THREE.MeshBasicMaterial({ color: 0xffc94a }));
  flame.position.set(x, y + 3.35 * s, z); scene.add(flame);
  glow(0xff9a30, 4 * s, flame, 0.7);
  const light = new THREE.PointLight(0xff9a40, 0.8, 32, 1.6);
  light.position.set(x, y + 4 * s, z); scene.add(light);
  candles.push({ flame, light, seed: Math.random() * 10 });
}

// ---------------------------------------------------------------- room
const W = ROOM.x1 - ROOM.x0, D = ROOM.z1 - ROOM.z0, CX = (ROOM.x0 + ROOM.x1) / 2, CZ = (ROOM.z0 + ROOM.z1) / 2;
const floorTex = canvasTex(256, 256, (g) => {
  const cols = ['#a5693b', '#9a6034', '#b07443', '#94592f'];
  for (let r = 0; r < 8; r++) {
    let x = -Math.random() * 120;
    while (x < 256) {
      const len = 90 + Math.random() * 110;
      g.fillStyle = cols[(Math.random() * cols.length) | 0]; g.fillRect(x, r * 32, len, 32);
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(x, r * 32, 3, 32);
      x += len;
    }
    g.fillStyle = 'rgba(0,0,0,.4)'; g.fillRect(0, r * 32, 256, 3);
  }
}, W / 16, D / 16);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.85 }));
floor.rotation.x = -Math.PI / 2; floor.position.set(CX, 0, CZ); floor.receiveShadow = true; scene.add(floor);

function wallTex(len) {
  return canvasTex(128, 128, (g) => {
    g.fillStyle = '#6a4fa8'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#5c4296'; g.fillRect(0, 0, 32, 128); g.fillRect(64, 0, 32, 128);
    g.fillStyle = '#e3b84e';
    for (const [x, y] of [[16, 32], [80, 96]]) { g.beginPath(); g.moveTo(x, y - 9); g.lineTo(x + 7, y); g.lineTo(x, y + 9); g.lineTo(x - 7, y); g.fill(); }
  }, len / 8, ROOM.h / 8);
}
const wallNS = new THREE.MeshStandardMaterial({ map: wallTex(W), roughness: 0.9 });
const wallWE = new THREE.MeshStandardMaterial({ map: wallTex(D), roughness: 0.9 });
camBlockers.push(
  box(W + 4, ROOM.h, 2, wallNS, CX, ROOM.h / 2, ROOM.z0 - 1, scene, { cast: false }),
  box(W + 4, ROOM.h, 2, wallNS, CX, ROOM.h / 2, ROOM.z1 + 1, scene, { cast: false }),
  box(2, ROOM.h, D + 4, wallWE, ROOM.x0 - 1, ROOM.h / 2, CZ, scene, { cast: false }),
  box(2, ROOM.h, D + 4, wallWE, ROOM.x1 + 1, ROOM.h / 2, CZ, scene, { cast: false }),
);
// wainscot + ceiling
const WAIN = M(0x6b3f22);
box(W, 6, 0.4, WAIN, CX, 3, ROOM.z0 + 0.2, scene, { cast: false });
box(0.4, 6, D, WAIN, ROOM.x0 + 0.2, 3, CZ, scene, { cast: false });
box(0.4, 6, D, WAIN, ROOM.x1 - 0.2, 3, CZ, scene, { cast: false });
box(W, 6, 0.4, WAIN, CX, 3, ROOM.z1 - 0.2, scene, { cast: false });
box(W, 0.6, 0.7, DARKWOOD, CX, 6.2, ROOM.z0 + 0.3, scene, { cast: false });
box(0.7, 0.6, D, DARKWOOD, ROOM.x0 + 0.3, 6.2, CZ, scene, { cast: false });
box(0.7, 0.6, D, DARKWOOD, ROOM.x1 - 0.3, 6.2, CZ, scene, { cast: false });
const ceil = box(W, 1, D, M(0x2c2140), CX, ROOM.h + 0.5, CZ, scene, { cast: false });
camBlockers.push(ceil);
for (let z = ROOM.z0 + 8; z < ROOM.z1; z += 14) box(W, 1.6, 2, DARKWOOD, CX, ROOM.h - 0.8, z, scene, { cast: false });

// window + moonlight patch (west wall)
box(0.6, 14, 12, DARKWOOD, ROOM.x0 + 0.3, 17, -4, scene, { cast: false });
const pane = M(0x9ec8ff, { emissive: 0x7aa8ff, emissiveIntensity: 0.9 });
for (const [y, z] of [[13.7, -6.8], [13.7, -1.2], [20.3, -6.8], [20.3, -1.2]]) box(0.3, 5.6, 4.6, pane, ROOM.x0 + 0.5, y, z, scene, { cast: false });
const moonPatch = new THREE.Mesh(new THREE.PlaneGeometry(14, 11), new THREE.MeshBasicMaterial({
  map: glowTex, color: 0x6f8fff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
moonPatch.rotation.x = -Math.PI / 2; moonPatch.position.set(-16, 0.04, -2); scene.add(moonPatch);

// ---- the door + mouse hole exit (south wall)
block(16, 26, 0.8, DARKWOOD, 0, 0, ROOM.z1 - 0.3);
block(14, 24, 0.5, M(0x8b5530), 0, 0, ROOM.z1 - 0.85, { cam: true });
for (const [x, y] of [[-3.4, 14], [3.4, 14], [-3.4, 5.5], [3.4, 5.5]]) box(5, y > 10 ? 9 : 5, 0.3, M(0x74431f), x, y + (y > 10 ? 2 : 0), ROOM.z1 - 1.2, scene, { cast: false });
const knob = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), GOLD); knob.position.set(5.2, 12, ROOM.z1 - 1.8); scene.add(knob);
box(3.4, 3.2, 0.1, M(0x2a1608), 0, 1.6, ROOM.z1 - 1.12, scene, { cast: false });
const holeGlow = M(0xffc070, { emissive: 0xffa040, emissiveIntensity: 1 });
box(2.4, 2.6, 0.1, holeGlow, 0, 1.3, ROOM.z1 - 1.14, scene, { cast: false });
const arch = new THREE.Mesh(new THREE.CircleGeometry(1.2, 16, 0, Math.PI), holeGlow);
arch.position.set(0, 2.6, ROOM.z1 - 1.14); arch.rotation.y = Math.PI; scene.add(arch);
const exitSign = textSprite('EXIT', '#6dff8f', 1.6); exitSign.position.set(0, 5.2, ROOM.z1 - 1.6); scene.add(exitSign);
const exitPad = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshBasicMaterial({
  map: glowTex, color: 0x4dff7a, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
exitPad.rotation.x = -Math.PI / 2; exitPad.position.set(0, 0.05, ROOM.z1 - 2.5); scene.add(exitPad);
const beamGeo = new THREE.CylinderGeometry(1, 1.6, ROOM.h, 16, 1, true);
const exitBeam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0x4dff7a, transparent: true, opacity: 0.12,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
exitBeam.position.set(0, ROOM.h / 2, ROOM.z1 - 2.5); scene.add(exitBeam);

// ---- the bed
const BED = { x0: -11.5, x1: 11.5, z0: -41.5, z1: -8.5 };
block(23, 2.5, 33, DARKWOOD, 0, 0, -25, { solid: true, cam: true });
block(22, 2.5, 31.5, M(0xeef2ff), 0, 2.5, -25.5, { solid: true, cam: true });
block(23.5, 18, 1.4, DARKWOOD, 0, 0, -41.3, { solid: true, cam: true });
block(23.5, 7, 1.2, DARKWOOD, 0, 0, -8.6, { solid: true, cam: true });
for (const x of [-11.6, 11.6]) {
  for (const [z, h] of [[-41.2, 21], [-8.6, 9]]) {
    block(1.6, h, 1.6, WOOD, x, 0, z, { solid: true });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1.2, 8, 6), GOLD); ball.position.set(x, h + 0.8, z); ball.castShadow = true; scene.add(ball);
  }
}
box(16, 3, 6, M(0xffffff), 0, 6.5, -38);
const backPillow = box(17, 3, 14, M(0xfff4e0), 0, 11, -36); backPillow.rotation.x = 0.8;
const quilt = new THREE.MeshStandardMaterial({ roughness: 0.9, map: canvasTex(128, 128, (g) => {
  const c = ['#e85d75', '#f4b942', '#5cc8a8', '#6f86e8'];
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.fillStyle = c[(i + j * 3) % 4]; g.fillRect(i * 32, j * 32, 32, 32); }
  g.strokeStyle = 'rgba(255,255,255,.6)'; g.setLineDash([5, 4]); g.lineWidth = 2;
  for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, 128); g.moveTo(0, i * 32); g.lineTo(128, i * 32); g.stroke(); }
}, 2, 2) });
block(23.2, 5.6, 15, quilt, 0, 4.7, -16.2);
// giant rug under the bed
block(34, 0.08, 40, M(0xb8323f), 0, 0, -22, { cast: false });
block(30, 0.1, 36, M(0xd9a441), 0, 0, -22, { cast: false });
block(28, 0.12, 34, M(0x9c2433), 0, 0, -22, { cast: false });

// ---- nightstands + wardrobe
block(7, 7, 6, WOOD, -19.5, 0, -35, { solid: true, cam: true });
box(5, 1.6, 0.3, DARKWOOD, -19.5, 4.5, -31.9, scene, { cast: false });
candle(-19.5, 7, -35, 1.1);
block(7, 7, 6, WOOD, 19.5, 0, -35, { solid: true, cam: true });
box(5, 1.6, 0.3, DARKWOOD, 19.5, 4.5, -31.9, scene, { cast: false });
const books = [0xd94a4a, 0x3f7fe0, 0x4fbf6a, 0xf0b93a, 0x9b59d0];
for (let i = 0; i < 3; i++) block(4.2 - i * 0.5, 0.9, 3.2 - i * 0.3, books[i], 19.5, 7 + i * 0.9, -35 + i * 0.2);
block(10, 24, 7, M(0x7a4a2a), 23, 0, -14, { solid: true, cam: true });
box(0.3, 20, 3.2, DARKWOOD, 17.9, 12, -15.8, scene, { cast: false });
box(0.3, 20, 3.2, DARKWOOD, 17.9, 12, -12.2, scene, { cast: false });
box(0.3, 0.8, 0.8, GOLD, 17.7, 12, -14.5, scene, { cast: false }); box(0.3, 0.8, 0.8, GOLD, 17.7, 12, -13.5, scene, { cast: false });

// ---- table + chair (hiding spots)
block(13, 0.9, 10, WOOD, 16, 7, 3, { cam: true });
for (const [x, z] of [[10.2, -1.3], [21.8, -1.3], [10.2, 7.3], [21.8, 7.3]]) block(1.1, 7, 1.1, DARKWOOD, x, 0, z, { solid: true });
candle(19.5, 7.9, 5.5, 0.7);
block(4, 0.5, 3, CREAM, 13, 7.9, 1.5); block(3.4, 1.4, 3.4, M(0x6ab0e0), 14, 7.9, 6);
block(6, 0.8, 6, WOOD, 16, 4.2, 14.5, { solid: true, cam: true });
for (const [x, z] of [[13.4, 11.9], [18.6, 11.9], [13.4, 17.1], [18.6, 17.1]]) block(0.8, 4.2, 0.8, DARKWOOD, x, 0, z, { solid: true });
block(6, 8, 0.8, WOOD, 16, 5, 17.3, { solid: true });

// ---- treasure chest (open)
block(6.4, 3, 4.4, M(0x8b4f22), -19, 0, -10, { solid: true, cam: true });
for (const x of [-21.6, -16.4]) box(0.5, 3.1, 4.5, GOLD, x, 1.5, -10);
block(5.8, 0.8, 3.8, GOLD, -19, 3, -10);
const lid = box(6.4, 0.6, 4.4, M(0x8b4f22), -19, 4.9, -12.6); lid.rotation.x = -1.2;
for (let i = 0; i < 9; i++) cyl(0.45, 0.45, 0.12, GOLD, -19 + rand(-2.6, 2.6), 3.85, -10 + rand(-1.5, 1.5), 10).rotation.set(rand(-.4, .4), 0, rand(-.4, .4));
for (let i = 0; i < 10; i++) cyl(0.45, 0.45, 0.12, GOLD, -19 + rand(-5, 5), 0.06, -6.5 + rand(-1.5, 2), 10);

// ---- giant books: climbable stack (goblet) + open book tent (hiding)
function book(w, h, d, color, x, y, z, solid = true) {
  block(w, h, d, color, x, y, z, { solid, cam: true });
  box(w - 0.3, h * 0.7, d + 0.05, CREAM, x + 0.15, y + h / 2, z, scene, { cast: false });
}
book(6, 1.2, 5, 0xd94a4a, -17, 0, 6);
book(4, 1.2, 3.5, 0x3f7fe0, -17.5, 1.2, 6);
book(1.6, 8, 6, 0x4fbf6a, -22.5, 0, 6);
book(1.6, 7, 6, 0xf0b93a, -24.3, 0, 6);
const tent = new THREE.Group(); tent.position.set(-7, 0, -8); scene.add(tent);
for (const s of [-1, 1]) {
  const cover = box(7.2, 0.35, 4.6, M(0x9b59d0), 0, 1.65, s * 1.55, tent);
  cover.rotation.x = s * 0.82;
  const page = box(6.8, 0.15, 4.3, CREAM, 0, 1.45, s * 1.42, tent, { cast: false });
  page.rotation.x = s * 0.82;
}
solids.push({ x0: -10.6, x1: -3.4, y0: 0, y1: 1.4, z0: -11.4, z1: -10.6 }, { x0: -10.6, x1: -3.4, y0: 0, y1: 1.4, z0: -5.4, z1: -4.6 });

// ---- slippers, clock, bookshelf, candles
function slipper(x, z, ry) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  box(4, 1.6, 8, M(0xff8fb8), 0, 0.8, 0, g); box(4.2, 1.2, 3.8, M(0xffb6d2), 0, 1.8, 1.6, g);
  const puff = new THREE.Mesh(new THREE.SphereGeometry(1.1, 8, 6), M(0xffffff)); puff.position.set(0, 2.6, 3.2); puff.castShadow = true; g.add(puff);
  const c = Math.cos(ry), s = Math.sin(ry), hw = Math.abs(c) * 2 + Math.abs(s) * 4, hd = Math.abs(s) * 2 + Math.abs(c) * 4;
  solids.push({ x0: x - hw, x1: x + hw, y0: 0, y1: 1.6, z0: z - hd, z1: z + hd });
}
slipper(22, -4.5, 0.25); slipper(22.5, -25, -0.2);

block(4.5, 17, 3.5, M(0x6b3f22), -25, 0, 27, { solid: true, cam: true });
const clockFace = cyl(1.7, 1.7, 0.3, CREAM, -25, 13.5, 28.9, 16); clockFace.rotation.x = Math.PI / 2;
const pendulum = new THREE.Group(); pendulum.position.set(-25, 10.5, 28.85); scene.add(pendulum);
box(0.15, 5, 0.1, GOLD, 0, -2.5, 0, pendulum); cyl(0.6, 0.6, 0.15, GOLD, 0, -5, 0, 12, pendulum).rotation.x = Math.PI / 2;
box(0.15, 1.3, 0.1, M(0x222222), -25, 13.9, 29.1, scene, { cast: false });

block(3, 18, 14, M(0x6b3f22), 26.5, 0, 26, { solid: true, cam: true });
for (let r = 0; r < 4; r++) {
  box(3.1, 0.4, 14, DARKWOOD, 26.4, 4.4 * r + 0.2, 26, scene, { cast: false });
  let z = 19.5;
  while (z < 32.3) { const w = rand(0.7, 1.3); box(0.4, rand(2.6, 3.8), w * 0.9, books[(Math.random() * 5) | 0], 24.9, 4.4 * r + 2.2, z + w / 2); z += w; }
}
candle(7, 0, 33, 1.6);
candle(-8, 0, 25, 1.2);

// ---- squeaky floorboards (visible traps)
const creakTex = canvasTex(64, 64, (g) => {
  g.fillStyle = '#d9a46a'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = '#5a3418'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(6, 20); g.lineTo(22, 30); g.lineTo(30, 22); g.lineTo(46, 36); g.lineTo(58, 30); g.stroke();
  g.beginPath(); g.moveTo(10, 48); g.lineTo(26, 42); g.lineTo(40, 52); g.stroke();
  g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 0, 64, 3); g.fillRect(0, 61, 64, 3);
});
const creaks = [[-16.5, -18], [13, -4.5], [2, -2.5]].map(([x, z]) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.14, 2.5), new THREE.MeshStandardMaterial({ map: creakTex, roughness: 0.9 }));
  m.position.set(x, 0.07, z); m.receiveShadow = true; scene.add(m);
  return { x, z, hw: 1.6, hd: 1.25, on: false, mesh: m };
});

const HIDES = [
  { x0: 10.8, x1: 21.2, z0: -0.8, z1: 6.8, ymax: 6 },     // under the table
  { x0: 13.8, x1: 18.2, z0: 12.3, z1: 16.7, ymax: 3.5 },  // under the chair
  { x0: -10.4, x1: -3.6, z0: -10.2, z1: -5.8, ymax: 2.5 } // inside the book tent
];

// ---------------------------------------------------------------- loot
const LOOT_DEFS = [
  { name: 'Coin Bag', v: 10, n: 4, kind: 'bag', p: [-9, 0, 29] },
  { name: 'Coin Bag', v: 10, n: 4, kind: 'bag', p: [11, 0, 23] },
  { name: 'Silver Cup', v: 20, n: 6, kind: 'cup', p: [-18, 0, 17] },
  { name: 'Silver Cup', v: 20, n: 6, kind: 'cup', p: [5, 0, 13] },
  { name: 'Golden Goblet', v: 50, n: 10, kind: 'goblet', p: [-17.5, 2.4, 6] },
  { name: 'Golden Goblet', v: 50, n: 10, kind: 'goblet', p: [4, 0, 1] },
  { name: 'Gem', v: 80, n: 12, kind: 'gem', p: [16, 0, 3], color: 0x38e0ff },
  { name: 'Gem', v: 80, n: 12, kind: 'gem', p: [-7, 0, -8], color: 0xff3fa0 },
  { name: 'Gold Statue', v: 120, n: 16, kind: 'statue', p: [-19, 0, -5] },
  { name: 'Golden Ring', v: 180, n: 20, kind: 'ring', p: [13.2, 0, -15.5] },
  { name: 'Giant Necklace', v: 300, n: 28, kind: 'necklace', p: [14.5, 0, -28] },
  { name: 'Crown', v: 500, n: 40, kind: 'crown', p: [-15.5, 1.6, -25] },
];
function lootMesh(d) {
  const g = new THREE.Group();
  const gem = (c) => M(c, { emissive: c, emissiveIntensity: 0.6, roughness: 0.2 });
  switch (d.kind) {
    case 'bag': {
      const sack = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), M(0xa8743f)); sack.position.y = 0.5; sack.scale.y = 0.9; sack.castShadow = true; g.add(sack);
      box(0.35, 0.3, 0.35, M(0xa8743f), 0, 1.05, 0, g); box(0.45, 0.12, 0.45, GOLD, 0, 0.92, 0, g);
      for (let i = 0; i < 4; i++) cyl(0.2, 0.2, 0.07, GOLD, Math.cos(i * 1.6) * 0.75, 0.04, Math.sin(i * 1.6) * 0.75, 10, g);
      break;
    }
    case 'cup':
      cyl(0.42, 0.3, 0.7, SILVER, 0, 0.85, 0, 10, g); cyl(0.09, 0.09, 0.4, SILVER, 0, 0.3, 0, 6, g); cyl(0.35, 0.35, 0.1, SILVER, 0, 0.05, 0, 10, g);
      break;
    case 'goblet':
      cyl(0.55, 0.35, 0.8, GOLD, 0, 1.15, 0, 10, g); cyl(0.11, 0.11, 0.6, GOLD, 0, 0.45, 0, 6, g); cyl(0.42, 0.42, 0.14, GOLD, 0, 0.07, 0, 10, g);
      box(0.25, 0.25, 0.1, gem(0xff2a4a), 0, 1.15, 0.5, g);
      break;
    case 'gem': {
      const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.6), gem(d.color)); m.position.y = 0.8; m.scale.y = 1.3; m.castShadow = true; g.add(m);
      break;
    }
    case 'statue':
      box(1, 0.3, 1, GOLD, 0, 0.15, 0, g); box(0.6, 0.9, 0.4, GOLD, 0, 0.75, 0, g); box(0.5, 0.5, 0.5, GOLD, 0, 1.45, 0, g);
      box(0.2, 0.7, 0.2, GOLD, -0.45, 1.3, 0, g).rotation.z = 0.5; box(0.2, 0.7, 0.2, GOLD, 0.45, 1.3, 0, g).rotation.z = -0.5;
      break;
    case 'ring': {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.17, 6, 16), GOLD); r.position.y = 0.85; r.castShadow = true; g.add(r);
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), gem(0x3fff8a)); s.position.y = 1.55; g.add(s);
      break;
    }
    case 'necklace': {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.16, 5, 14), GOLD); r.position.y = 0.95; r.castShadow = true; g.add(r);
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; box(0.32, 0.32, 0.32, gem([0xff2a4a, 0x38e0ff][i % 2]), Math.cos(a), 0.95 + Math.sin(a), 0, g); }
      const pend = new THREE.Mesh(new THREE.OctahedronGeometry(0.42), gem(0xff2a4a)); pend.position.y = -0.2; pend.scale.y = 1.4; g.add(pend);
      g.children.forEach((c) => { c.position.y += 0.45; });
      break;
    }
    case 'crown': {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.85, 0.75, 0.6, 8, 1, true),
        M(0xffc928, { roughness: 0.3, metalness: 0.35, emissive: 0x7a4c00, emissiveIntensity: 0.8, side: THREE.DoubleSide }));
      band.position.y = 0.4; band.castShadow = true; g.add(band);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        const sp = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.55, 4), GOLD); sp.position.set(Math.cos(a) * 0.82, 0.95, Math.sin(a) * 0.82); g.add(sp);
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), gem(0xff2a4a)); ball.position.set(Math.cos(a) * 0.82, 1.25, Math.sin(a) * 0.82); g.add(ball);
        box(0.2, 0.2, 0.08, gem([0x38e0ff, 0x3fff8a, 0xff2a4a][i % 3]), Math.cos(a + 0.4) * 0.86, 0.4, Math.sin(a + 0.4) * 0.86, g).rotation.y = -a - 0.4 + Math.PI / 2;
      }
      g.scale.setScalar(1.3);
      break;
    }
  }
  return g;
}
// crown pedestal, beam and light
block(1.9, 1.2, 1.9, M(0x5b2d8a), -15.5, 0, -25, { solid: true });
box(2.1, 0.2, 2.1, GOLD, -15.5, 1.2, -25);
box(1.6, 0.35, 1.6, M(0xc8203a), -15.5, 1.42, -25);
const crownBeam = new THREE.Mesh(beamGeo, new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.16,
  blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
crownBeam.position.set(-15.5, ROOM.h / 2, -25); crownBeam.scale.set(1.2, 1, 1.2); scene.add(crownBeam);
const crownLight = new THREE.PointLight(0xffcf40, 1.4, 14, 1.5); crownLight.position.set(-15.5, 4, -25); scene.add(crownLight);

const loot = LOOT_DEFS.map((d) => {
  const g = lootMesh(d);
  g.position.set(...d.p); scene.add(g);
  const gl = glow(0xffd040, 1.6 + d.v / 120, scene, 0.45);
  gl.position.set(d.p[0], d.p[1] + 0.9, d.p[2]);
  return { d, g, gl, taken: false, center: new THREE.Vector3(d.p[0], d.p[1] + 0.8, d.p[2]), spin: Math.random() * 6 };
});

// ---------------------------------------------------------------- giant
const G = (() => {
  const SKIN = M(0xf0b48a), SHIRT = M(0x7fb2ff), PANTS = M(0x3f5fc8), BEARD = M(0x8a5530), DARK = M(0x2a1410);
  const root = new THREE.Group(); root.scale.setScalar(1.5); scene.add(root);
  const body = new THREE.Group(); body.position.y = 10; root.add(body);   // pivots at the hips
  const inner = new THREE.Group(); inner.position.y = -10; body.add(inner);
  const hip = (x) => {
    const p = new THREE.Group(); p.position.set(x, 10, 0); inner.add(p);
    box(3.4, 9, 3.6, PANTS, 0, -4.5, 0, p);
    const ankle = new THREE.Group(); ankle.position.y = -8.2; p.add(ankle);
    box(3.6, 2, 5, SKIN, 0, -0.8, 0.7, ankle);
    for (let i = 0; i < 3; i++) box(0.9, 0.9, 0.7, SKIN, -1.1 + i * 1.1, -0.4, 3.4, ankle);
    p.ankle = ankle;
    return p;
  };
  const hipL = hip(-2.1), hipR = hip(2.1);
  const torso = new THREE.Group(); torso.position.y = 10; inner.add(torso);
  box(9.4, 8.6, 5.4, SHIRT, 0, 4.3, 0, torso);
  box(7.6, 5, 1.8, SHIRT, 0, 3.3, 3.0, torso);
  box(9.5, 0.7, 5.5, M(0xffffff), 0, 1.6, 0, torso, { cast: false }); box(9.5, 0.7, 5.5, M(0xffffff), 0, 6.4, 0, torso, { cast: false });
  for (let i = 0; i < 3; i++) box(0.6, 0.6, 0.3, GOLD, 0, 2.2 + i * 1.9, 3.95, torso, { cast: false });
  const shoulder = (x) => {
    const p = new THREE.Group(); p.position.set(x, 17.6, 0); inner.add(p);
    box(2.8, 8.2, 2.8, SHIRT, 0, -3.9, 0, p);
    box(3, 2.6, 3, SKIN, 0, -9.2, 0, p);
    return p;
  };
  const shL = shoulder(-6.1), shR = shoulder(6.1);
  const neck = new THREE.Group(); neck.position.y = 18.6; neck.scale.setScalar(1.2); inner.add(neck);
  box(6.6, 6.2, 6.2, SKIN, 0, 3.1, 0, neck);
  box(1.6, 2, 1.5, M(0xe8907a), 0, 2.8, 3.6, neck);
  box(0.8, 1.8, 1.4, SKIN, -3.6, 3.1, 0, neck); box(0.8, 1.8, 1.4, SKIN, 3.6, 3.1, 0, neck);
  box(6.8, 2.8, 2.2, BEARD, 0, 0.6, 2.4, neck); box(6.8, 4, 1.4, BEARD, 0, 3.6, -2.6, neck);
  box(4.4, 0.9, 0.8, BEARD, 0, 1.9, 3.5, neck);
  const mouth = box(2.2, 0.5, 0.3, DARK, 0, 1.0, 3.55, neck, { cast: false });
  const browL = box(2.3, 0.6, 0.6, BEARD, -1.6, 5.0, 3.15, neck), browR = box(2.3, 0.6, 0.6, BEARD, 1.6, 5.0, 3.15, neck);
  const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xff1010, emissiveIntensity: 0 });
  const eyes = [-1.6, 1.6].map((x) => {
    const line = box(1.8, 0.25, 0.2, DARK, x, 4.0, 3.15, neck, { cast: false });
    const white = box(1.6, 1.5, 0.2, M(0xffffff), x, 4.0, 3.17, neck, { cast: false });
    box(0.7, 0.75, 0.1, pupilMat, 0, -0.1, 0.12, white, { cast: false });
    return { line, white };
  });
  box(7, 1.2, 6.8, M(0xffffff), 0, 6.3, 0, neck);
  const cap = new THREE.Group(); cap.position.set(0, 6.6, 0); cap.rotation.z = 0.7; neck.add(cap);
  const cone = new THREE.Mesh(new THREE.CylinderGeometry(0, 3.3, 6, 4), M(0xe23b3b)); cone.rotation.y = Math.PI / 4; cone.position.y = 3; cone.castShadow = true; cap.add(cone);
  box(1.6, 1.6, 1.6, M(0xffffff), 0, 6.2, 0, cap);
  return { root, body, hipL, hipR, torso, shL, shR, neck, mouth, browL, browR, eyes, pupilMat,
    mode: 'sleep', t: 0, raise: 0, eye: 0, roll: 0, rollT: 0, toss: 3, look: 0,
    heading: 0, speed: 0, phase: 0, stompCD: 3, stompT: -1, chaseT: 0, lastStep: 0,
    from: new THREE.Vector3(), to: new THREE.Vector3() };
})();

// reclined against the headboard pillows, legs flat on the bed, facing the room
const SLEEP_POS = new THREE.Vector3(0, -7.3, -24.5);
const RECLINE = -0.8;
function reclinePose(lean) {
  G.body.rotation.x = RECLINE + lean;
  G.hipL.rotation.x = G.hipR.rotation.x = -Math.PI / 2 - G.body.rotation.x;
  G.hipL.ankle.rotation.x = G.hipR.ankle.rotation.x = 1.3;
  G.shL.rotation.set(-0.35, 0, 0.12); G.shR.rotation.set(-0.35, 0, -0.12);
}
function giantSleepPose() {
  G.mode = 'sleep'; G.t = 0; G.raise = 0; G.eye = 0; G.roll = 0; G.rollT = 0; G.look = 0;
  G.root.position.copy(SLEEP_POS); G.root.rotation.set(0, 0, 0);
  G.neck.rotation.set(0, 0, 0);
  G.mouth.scale.set(1, 1, 1);
  reclinePose(0);
  G.browL.rotation.z = 0; G.browR.rotation.z = 0;
  G.pupilMat.emissiveIntensity = 0;
  G.stompT = -1; G.stompCD = 3; G.chaseT = 0; G.phase = 0;
}
function setEyes(open) {
  for (const e of G.eyes) { e.white.scale.y = Math.max(0.01, open); e.white.visible = open > 0.05; e.line.visible = open <= 0.05; }
}

// ---------------------------------------------------------------- player
const P = { pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), vy: 0,
  grounded: true, coyote: 0, jumpBuf: 0, face: Math.PI, slowT: 0, stepDist: 0, hidden: false, airT: 0, anim: 0 };
const pm = (() => {
  const YEL = M(0xffd23f), BLUE = M(0x2f7ff0), GREEN = M(0x3ec46d), BLK = M(0x111111);
  const g = new THREE.Group(); scene.add(g);
  const leg = (x) => { const p = new THREE.Group(); p.position.set(x, 0.8, 0); g.add(p); box(0.38, 0.8, 0.42, GREEN, 0, -0.4, 0, p); return p; };
  const arm = (x) => { const p = new THREE.Group(); p.position.set(x, 1.55, 0); g.add(p); box(0.36, 0.78, 0.38, YEL, 0, -0.36, 0, p); return p; };
  const legL = leg(-0.2), legR = leg(0.2);
  box(0.8, 0.8, 0.46, BLUE, 0, 1.2, 0, g);
  const armL = arm(-0.6), armR = arm(0.6);
  box(0.56, 0.56, 0.56, YEL, 0, 1.88, 0, g);
  box(0.09, 0.15, 0.04, BLK, -0.12, 1.94, 0.28, g, { cast: false }); box(0.09, 0.15, 0.04, BLK, 0.12, 1.94, 0.28, g, { cast: false });
  box(0.24, 0.05, 0.04, BLK, 0, 1.76, 0.28, g, { cast: false });
  const bag = new THREE.Group(); bag.position.set(0, 1.2, -0.4); g.add(bag);
  const sack = new THREE.Mesh(new THREE.SphereGeometry(0.55, 8, 6), M(0x9b6a3c)); sack.castShadow = true; sack.position.z = -0.35; bag.add(sack);
  box(0.3, 0.3, 0.3, GOLD, 0, 0.5, -0.35, bag);
  const blob = new THREE.Mesh(new THREE.CircleGeometry(0.6, 16), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }));
  blob.rotation.x = -Math.PI / 2; scene.add(blob);
  return { g, legL, legR, armL, armR, bag, blob };
})();

// ---------------------------------------------------------------- fx: particles, rings, floaters, zzz
const partGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
const partMats = new Map();
const parts = [];
function burst(pos, color, n, speed = 6, life = 0.9, size = 1) {
  if (!partMats.has(color)) partMats.set(color, new THREE.MeshBasicMaterial({ color }));
  for (let i = 0; i < n; i++) {
    let p = parts.find((q) => q.life <= 0);
    if (!p) { p = { m: new THREE.Mesh(partGeo), v: new THREE.Vector3(), life: 0 }; scene.add(p.m); parts.push(p); }
    p.m.material = partMats.get(color); p.m.visible = true;
    p.m.position.copy(pos); p.size = size * rand(0.6, 1.3); p.m.scale.setScalar(p.size);
    p.v.set(rand(-1, 1), rand(0.6, 1.6), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.5, 1));
    p.life = p.max = life * rand(0.7, 1.2);
  }
}
const ringGeo = new THREE.RingGeometry(0.85, 1, 40);
const rings = [];
function ring(pos, color, maxR, dur = 0.7, opacity = 0.8) {
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(pos.x, pos.y + 0.08, pos.z); scene.add(m);
  rings.push({ m, t: 0, dur, maxR, opacity });
}
const waves = []; // stomp shockwaves
const floaters = [];
function floatText(text, pos, color = '#ffd54a', size = 42) {
  const el = document.createElement('div'); el.className = 'floater o'; el.textContent = text;
  el.style.color = color; el.style.fontSize = size + 'px';
  $('floaters').appendChild(el);
  floaters.push({ el, p: pos.clone(), t: 0, life: 1.3 });
}
const zzz = [];
const zSprite = textSprite('Z', '#ffffff', 1.4);
function spawnZ() {
  const s = new THREE.Sprite(zSprite.material.clone()); scene.add(s);
  s.position.set(rand(-1, 1) + 3, 26, -33);
  zzz.push({ s, t: 0, dx: rand(-0.6, 0.6) });
}

// ---------------------------------------------------------------- audio (all synthesized)
const SFX = {
  ctx: null, master: null, nbuf: null, mus: null,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    this.ctx = new AC(); this.master = this.ctx.createGain(); this.master.gain.value = 0.8; this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2; this.nbuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.nbuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },
  env(g, t, vol, attack, dur) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(vol, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  },
  tone(f, dur, { type = 'sine', vol = 0.2, to = null, when = 0, attack = 0.005, filter = null } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when, o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    let n = o; if (filter) { const fl = c.createBiquadFilter(); fl.frequency.value = filter; o.connect(fl); n = fl; }
    this.env(g, t, vol, attack, dur); n.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, { vol = 0.2, freq = 1000, to = null, type = 'lowpass', when = 0, attack = 0.005, q = 1 } = {}) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + when, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.nbuf; s.loop = true; f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t); if (to) f.frequency.exponentialRampToValueAtTime(to, t + dur);
    this.env(g, t, vol, attack, dur); s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  step(run) { this.noise(0.05, { vol: run ? 0.07 : 0.03, freq: run ? 1500 : 900 }); },
  jump() { this.tone(330, 0.12, { type: 'square', to: 620, vol: 0.05, filter: 2000 }); },
  land(v) { this.noise(0.14, { vol: 0.12 * v, freq: 500 }); },
  pickup(v) {
    const lvl = v >= 500 ? 6 : v >= 180 ? 5 : v >= 80 ? 4 : v >= 40 ? 3 : 2;
    const notes = [0, 4, 7, 12, 16, 19, 24];
    for (let i = 0; i <= lvl; i++) this.tone(mtof(76 + notes[i]), 0.22, { type: 'triangle', vol: 0.16, when: i * 0.055 });
    this.noise(0.35, { vol: 0.06, freq: 7000, type: 'highpass', when: 0.02 });
    if (v >= 500) [72, 76, 79, 84].forEach((m) => this.tone(mtof(m), 1.2, { type: 'square', vol: 0.04, when: 0.4, filter: 3000, attack: 0.02 }));
  },
  snore(vol) {
    this.noise(1.6, { vol, freq: 240, to: 700, attack: 0.8 });
    this.tone(46, 1.6, { type: 'sawtooth', vol: vol * 0.6, attack: 0.8, filter: 260 });
    this.tone(760, 1.1, { vol: vol * 0.1, to: 380, when: 1.9, attack: 0.3 });
    this.noise(1.1, { vol: vol * 0.35, freq: 1300, to: 400, type: 'bandpass', when: 1.9, attack: 0.2 });
  },
  grunt(vol = 0.28) {
    this.tone(130, 0.5, { type: 'sawtooth', to: 72, vol, filter: 600, attack: 0.03 });
    this.noise(0.35, { vol: vol * 0.4, freq: 300 });
  },
  hmm() {
    this.tone(92, 0.8, { type: 'sawtooth', to: 150, vol: 0.32, filter: 700, attack: 0.06 });
    this.tone(mtof(50), 1.4, { type: 'square', vol: 0.05, filter: 1100, when: 0.1, attack: 0.05 });
    this.tone(mtof(56), 1.4, { type: 'square', vol: 0.05, filter: 1100, when: 0.1, attack: 0.05 });
  },
  heartbeat(vol) { this.tone(64, 0.14, { vol, to: 40 }); this.tone(58, 0.14, { vol: vol * 0.75, to: 36, when: 0.17 }); },
  roar() {
    this.tone(190, 1.7, { type: 'sawtooth', to: 55, vol: 0.45, filter: 900, attack: 0.05 });
    this.tone(95, 1.7, { type: 'square', to: 40, vol: 0.2, filter: 500, attack: 0.05 });
    this.noise(1.5, { vol: 0.45, freq: 900, to: 200, attack: 0.05 });
  },
  stomp(vol) { this.tone(110, 0.55, { to: 28, vol }); this.noise(0.5, { vol: vol * 0.8, freq: 420, to: 70 }); },
  thud(vol) { this.tone(80, 0.25, { to: 35, vol }); },
  creak() {
    this.tone(430, 0.25, { type: 'sawtooth', to: 300, vol: 0.09, filter: 1600 });
    this.tone(300, 0.3, { type: 'sawtooth', to: 540, vol: 0.08, filter: 1600, when: 0.18 });
  },
  tick(hi) { this.noise(0.03, { vol: 0.05, freq: hi ? 4500 : 3200, type: 'bandpass', q: 4 }); },
  fanfare() {
    [[72, 0], [76, 0.12], [79, 0.24], [84, 0.36]].forEach(([m, w]) => this.tone(mtof(m), 0.3, { type: 'square', vol: 0.07, when: w, filter: 3000 }));
    [72, 76, 79, 84].forEach((m) => this.tone(mtof(m), 1.3, { type: 'triangle', vol: 0.12, when: 0.5, attack: 0.02 }));
  },
  sad() { [[67, 0, 0.35], [66, 0.38, 0.35], [65, 0.76, 0.35], [64, 1.14, 1.0]].forEach(([m, w, d]) => this.tone(mtof(m - 12), d, { type: 'sawtooth', vol: 0.14, when: w, filter: 900, attack: 0.03 })); },
  laugh() { for (let i = 0; i < 3; i++) this.tone(150, 0.22, { type: 'sawtooth', to: 105, vol: 0.32, filter: 700, when: i * 0.28, attack: 0.02 }); },
  whoosh() { this.noise(0.5, { vol: 0.2, freq: 400, to: 3000, type: 'bandpass' }); },
  startChase() {
    if (!this.ctx) return;
    this.stopChase();
    const mus = this.mus = { next: this.ctx.currentTime + 0.05, step: 0 };
    const bass = [45, 45, 57, 45, 48, 45, 57, 52, 43, 43, 55, 43, 47, 43, 55, 50];
    const spb = 60 / 165 / 2;
    mus.timer = setInterval(() => {
      while (mus.next < this.ctx.currentTime + 0.15) {
        const s = mus.step % 16, w = mus.next - this.ctx.currentTime;
        this.tone(mtof(bass[s]), spb * 0.9, { type: 'sawtooth', vol: 0.09, when: w, filter: 900 });
        if (s % 4 === 0) this.tone(150, 0.18, { to: 40, vol: 0.45, when: w });
        if (s % 4 === 2) this.noise(0.12, { vol: 0.16, freq: 1800, type: 'bandpass', when: w });
        this.noise(0.03, { vol: 0.04, freq: 7000, type: 'highpass', when: w });
        if (s % 8 === 0) this.tone(mtof(bass[s] + 24), spb * 3, { type: 'square', vol: 0.03, when: w, filter: 2500 });
        mus.next += spb; mus.step++;
      }
    }, 25);
  },
  stopChase() { if (this.mus) { clearInterval(this.mus.timer); this.mus = null; } },
};

// ---------------------------------------------------------------- input
const keys = {};
const input = { mx: 0, mz: 0, run: false, jump: false, steal: false };
let yaw = 0, pitch = 0.32, locked = false;
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
addEventListener('keydown', (e) => {
  if (e.repeat) { keys[e.code] = true; return; }
  keys[e.code] = true;
  if (e.code === 'Space') { e.preventDefault(); if (game.phase === 'play') P.jumpBuf = 0.12; else if (game.phase === 'end') tryRestart(); }
  if (e.code === 'KeyE' && game.phase === 'play') input.steal = true;
  if (e.code === 'Enter' && game.phase === 'end') tryRestart();
  if (e.code === 'KeyR' && game.phase === 'play' && G.mode === 'sleep') startRun();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
const cvs = renderer.domElement;
document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === cvs; });
let dragging = false;
cvs.addEventListener('mousedown', () => {
  if (game.phase === 'end') { tryRestart(); return; }
  if (game.phase === 'play' && !locked && !isTouch) { cvs.requestPointerLock && cvs.requestPointerLock(); }
  dragging = true;
});
addEventListener('mouseup', () => { dragging = false; });
addEventListener('mousemove', (e) => {
  if (locked || (dragging && !isTouch)) look(e.movementX, e.movementY, 0.0024);
});
function look(dx, dy, s) { yaw -= dx * s; pitch = clamp(pitch + dy * s, -0.12, 1.25); }

// touch controls
if (isTouch) {
  const stick = $('stick'), knob = $('knob');
  let stickId = null, lookId = null, sx = 0, sy = 0, lx = 0, ly = 0;
  addEventListener('touchstart', (e) => {
    if (game.phase !== 'play') return;
    for (const t of e.changedTouches) {
      if (t.target.classList && t.target.classList.contains('tbtn')) continue;
      if (t.clientX < innerWidth * 0.42 && stickId === null) {
        stickId = t.identifier; sx = t.clientX; sy = t.clientY;
        stick.style.left = (sx - 65) + 'px'; stick.style.top = (sy - 65) + 'px'; stick.style.bottom = 'auto';
      } else if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; }
    }
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) {
        let dx = t.clientX - sx, dy = t.clientY - sy; const l = Math.hypot(dx, dy), m = 55;
        if (l > m) { dx = dx / l * m; dy = dy / l * m; }
        input.mx = dx / m; input.mz = dy / m;
        knob.style.left = (40 + dx) + 'px'; knob.style.top = (40 + dy) + 'px';
      } else if (t.identifier === lookId) { look(t.clientX - lx, t.clientY - ly, 0.006); lx = t.clientX; ly = t.clientY; }
    }
  }, { passive: true });
  const end = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === stickId) { stickId = null; input.mx = input.mz = 0; knob.style.left = knob.style.top = '40px'; }
      if (t.identifier === lookId) lookId = null;
    }
  };
  addEventListener('touchend', end); addEventListener('touchcancel', end);
  $('tJump').addEventListener('touchstart', (e) => { e.preventDefault(); P.jumpBuf = 0.12; });
  $('tSteal').addEventListener('touchstart', (e) => { e.preventDefault(); input.steal = true; });
  $('tRun').addEventListener('touchstart', (e) => { e.preventDefault(); input.run = !input.run; $('tRun').classList.toggle('on', input.run); });
}

// ---------------------------------------------------------------- game state
const game = { phase: 'title', noise: 0, gstate: 0, loot: 0, quietT: 9, best: 0, runT: 0, breath: 0, hbT: 0, tickT: 0,
  tock: false, shake: 0, endT: 0, flash: 0, items: 0, crown: false, tipT: 0, taught: {}, fovKick: 0 };
const STATE_NAMES = ['DEEP SLEEP 😴', 'RESTLESS 😣', 'SUSPICIOUS 👁️', 'AWAKE!! 😡'];
const CLASSES = ['', 'restless', 'susp', 'awake'];

function tip(text, dur = 4) { $('tip').textContent = text; $('tip').style.opacity = 1; game.tipT = dur; }
function banner(text, color = '#ff4747') {
  const b = $('banner'); b.textContent = text; b.style.color = color;
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
}
function hearing(pos) {
  const d = pos.distanceTo(EAR);
  return 0.5 + 1.2 * clamp(1 - (d - 10) / 40, 0, 1);
}

function startRun() {
  game.phase = 'play'; game.noise = 0; game.gstate = 0; game.loot = 0; game.quietT = 9; game.runT = 0;
  game.shake = 0; game.items = 0; game.crown = false; game.hbT = 0; game.breath = 0;
  P.pos.set(0, 0, 32); P.vel.set(0, 0, 0); P.vy = 0; P.face = Math.PI; P.slowT = 0; P.grounded = true;
  yaw = 0; pitch = 0.1;
  for (const l of loot) { l.taken = false; l.g.visible = true; l.gl.visible = true; }
  for (const c of creaks) c.on = false;
  for (const w of waves) scene.remove(w.m);
  waves.length = 0;
  giantSleepPose(); setEyes(0);
  SFX.stopChase();
  $('end').classList.add('hidden'); $('start').classList.add('hidden'); $('hud').classList.remove('hidden');
  if (isTouch) $('touch').classList.remove('hidden');
  updateLootUI();
  tip(game.taught.intro ? 'Again! This time... the Crown? 👑' : 'Steal the treasure. Stay quiet. Escape through the mouse hole.', 5);
  game.taught.intro = true;
}
function tryRestart() {
  if (game.phase !== 'end' || game.endT < 0.6) return;
  SFX.init(); startRun();
  if (!isTouch && cvs.requestPointerLock) cvs.requestPointerLock();
}
$('playBtn').addEventListener('click', () => { SFX.init(); startRun(); if (!isTouch && cvs.requestPointerLock) cvs.requestPointerLock(); });
$('againBtn').addEventListener('click', tryRestart);

function updateLootUI() {
  const el = $('lootVal'); el.textContent = '$' + game.loot;
  el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 150);
}

function addNoise(amount, pos, showRing = true) {
  if (game.gstate >= 3 || game.phase !== 'play') return;
  game.noise = Math.min(100, game.noise + amount);
  game.quietT = 0;
  if (showRing && amount >= 2.5) {
    const col = amount >= 25 ? 0xff3030 : amount >= 10 ? 0xffa030 : 0xffffff;
    ring(pos, col, 2 + amount * 0.25, 0.8);
    $('meterWrap').classList.add('flash'); setTimeout(() => $('meterWrap').classList.remove('flash'), 120);
  }
}

function setGiantState(s) {
  const prev = game.gstate; game.gstate = s;
  if (s === 1 && prev === 0) {
    SFX.grunt(); G.rollT = rand(-0.14, 0.14); G.toss = rand(2.5, 4.5);
    if (!game.taught.restless) { game.taught.restless = true; tip('He stirs... stand still and the meter drains. 🤫', 4); }
  }
  if (s === 2) { SFX.hmm(); game.shake = Math.max(game.shake, 0.25); if (!game.taught.susp) { game.taught.susp = true; tip('FREEZE! Moving while he watches is extra loud. Hide under the table, the chair or the open book to calm him faster.', 6); } }
  if (s === 1 && prev === 2) SFX.grunt(0.15);
}

function wake() {
  game.gstate = 3; game.noise = 100;
  G.mode = 'wake'; G.t = 0;
  banner('THE GIANT WOKE UP!');
  SFX.roar(); SFX.startChase();
  game.shake = 1.3; game.flash = 0.5;
  tip('RUN! Back to the mouse hole! Jump his stomp shockwaves!', 5);
}

function endRun(win) {
  game.phase = 'end'; game.endT = 0;
  SFX.stopChase();
  if (document.pointerLockElement) document.exitPointerLock();
  const t = $('endTitle'), s = $('endSub'), x = $('endExtra');
  $('prompt').classList.add('hidden');
  if (win) {
    SFX.fanfare(); SFX.whoosh();
    t.textContent = 'ESCAPED!'; t.className = 'o win';
    const newBest = game.loot > game.best; game.best = Math.max(game.best, game.loot);
    let shown = 0; const target = game.loot;
    s.textContent = 'LOOT SECURED: $0';
    const iv = setInterval(() => { shown = Math.min(target, shown + Math.max(1, Math.ceil(target / 30))); s.textContent = 'LOOT SECURED: $' + shown; if (shown >= target) clearInterval(iv); }, 30);
    x.innerHTML = (game.crown ? '👑 YOU STOLE THE CROWN! 👑<br>' : (game.loot < 1420 ? 'The Crown is still sitting there... 👑<br>' : '')) +
      (game.items + (game.items === 1 ? ' treasure · ' : ' treasures · ') + game.runT.toFixed(1) + 's') + '<br>' + (newBest ? '⭐ NEW BEST! ⭐' : 'BEST: $' + game.best);
    $('againBtn').textContent = 'PLAY AGAIN';
    burst(new THREE.Vector3(0, 2, 37), 0x6dff8f, 40, 9, 1.4, 1.4); burst(new THREE.Vector3(0, 2, 37), 0xffd54a, 40, 9, 1.4, 1.4);
  } else {
    SFX.sad();
    t.textContent = 'CAUGHT!'; t.className = 'o lose';
    s.textContent = 'LOOT LOST: $' + game.loot;
    x.innerHTML = (game.crown ? 'So close... with the Crown and everything. 👑<br>' : '') + 'BEST: $' + game.best;
    $('againBtn').textContent = 'TRY AGAIN';
  }
  setTimeout(() => { if (game.phase === 'end') $('end').classList.remove('hidden'); }, win ? 700 : 300);
}

// ---------------------------------------------------------------- player update
function inHide() {
  const p = P.pos;
  return HIDES.some((h) => p.x > h.x0 && p.x < h.x1 && p.z > h.z0 && p.z < h.z1 && p.y < h.ymax);
}
function resolve(axis) {
  const p = P.pos, r = CFG.pr, h = CFG.ph, pv = P.prev;
  for (const b of solids) {
    if (p.x + r <= b.x0 || p.x - r >= b.x1 || p.z + r <= b.z0 || p.z - r >= b.z1 || p.y + h <= b.y0 || p.y >= b.y1) continue;
    if (axis === 'y') {
      if (pv.y >= b.y1 - 0.01) { p.y = b.y1; P.vy = 0; P.grounded = true; }
      else if (pv.y + h <= b.y0 + 0.01) { p.y = b.y0 - h - 0.001; P.vy = Math.min(P.vy, 0); }
      continue;
    }
    if (b.y1 - p.y <= 0.5 && P.grounded) { p.y = b.y1; continue; } // step up
    if (axis === 'x') {
      if (pv.x + r <= b.x0 + 0.01) p.x = b.x0 - r - 0.001; else if (pv.x - r >= b.x1 - 0.01) p.x = b.x1 + r + 0.001;
    } else {
      if (pv.z + r <= b.z0 + 0.01) p.z = b.z0 - r - 0.001; else if (pv.z - r >= b.z1 - 0.01) p.z = b.z1 + r + 0.001;
    }
  }
}
function groundBelow(x, z, y) {
  let gy = 0;
  for (const b of solids) if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && b.y1 <= y + 0.05 && b.y1 > gy) gy = b.y1;
  return gy;
}

function updatePlayer(dt) {
  const awake = game.gstate >= 3;
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz -= 1;
  if (keys.KeyS || keys.ArrowDown) iz += 1;
  if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1;
  ix += input.mx; iz += input.mz;
  let il = Math.hypot(ix, iz); if (il > 1) { ix /= il; iz /= il; il = 1; }
  const running = (keys.ShiftLeft || keys.ShiftRight || input.run) && il > 0.1;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const dx = rx * ix - fx * iz, dz = rz * ix - fz * iz;
  let speed = (running ? (awake ? CFG.panicRun : CFG.run) : CFG.walk) * il;
  if (P.slowT > 0) { P.slowT -= dt; speed *= 0.35; }
  const acc = P.grounded ? 14 : 5;
  P.vel.x = damp(P.vel.x, dx * speed, acc, dt);
  P.vel.z = damp(P.vel.z, dz * speed, acc, dt);
  if (il > 0.1) P.face += wrapAng(Math.atan2(dx, dz) - P.face) * (1 - Math.exp(-14 * dt));

  // jump
  P.coyote = P.grounded ? 0.1 : P.coyote - dt;
  P.jumpBuf -= dt;
  const m = hearing(P.pos);
  if (P.jumpBuf > 0 && P.coyote > 0) {
    P.vy = CFG.jumpV; P.grounded = false; P.coyote = 0; P.jumpBuf = 0;
    SFX.jump(); addNoise(CFG.noise.jump * m, P.pos);
  }
  P.vy -= CFG.gravity * dt;
  const fallV = P.vy;
  const wasGrounded = P.grounded;

  P.prev.copy(P.pos);
  P.pos.x += P.vel.x * dt; resolve('x');
  P.pos.z += P.vel.z * dt; resolve('z');
  P.grounded = false;
  P.pos.y += P.vy * dt; resolve('y');
  if (P.pos.y <= 0) { P.pos.y = 0; P.vy = 0; P.grounded = true; }
  // room bounds; the mouse hole lets you through the south wall
  const r = CFG.pr;
  P.pos.x = clamp(P.pos.x, ROOM.x0 + 0.6 + r, ROOM.x1 - 0.6 - r);
  const zMax = Math.abs(P.pos.x) < 1.1 && P.pos.y < 2 ? ROOM.z1 + 1 : ROOM.z1 - 1.1 - r;
  P.pos.z = clamp(P.pos.z, ROOM.z0 + 0.6 + r, zMax);

  if (P.grounded && !wasGrounded && fallV < -5) {
    SFX.land(clamp(-fallV / 12, 0.3, 1.2));
    addNoise(CFG.noise.land * m * clamp(-fallV / 10, 0.6, 1.4), P.pos);
    burst(P.pos, 0xd9c6a0, 6, 2.5, 0.4, 0.8);
  }

  // continuous movement noise
  const hspd = Math.hypot(P.vel.x, P.vel.z);
  if (!awake && hspd > 0.5 && P.grounded) {
    const watch = game.gstate === 2 ? CFG.noise.watchMul : 1;
    addNoise((running ? CFG.noise.run : CFG.noise.walk) * m * watch * dt * clamp(hspd / CFG.walk, 0.3, 1.2), P.pos, false);
  }
  // footsteps
  if (P.grounded && hspd > 0.5) {
    P.stepDist += hspd * dt;
    const stride = running ? 1.9 : 1.4;
    if (P.stepDist > stride) {
      P.stepDist = 0; SFX.step(running);
      if (running && !awake) ring(P.pos, 0xffffff, 1.6 + m, 0.5, 0.45);
    }
  }
  // squeaky boards
  for (const c of creaks) {
    const on = P.grounded && P.pos.y < 0.3 && Math.abs(P.pos.x - c.x) < c.hw && Math.abs(P.pos.z - c.z) < c.hd;
    if (on && !c.on) {
      SFX.creak(); c.mesh.position.y = 0.0;
      if (!awake) { addNoise(CFG.noise.creak * m, P.pos); floatText('*CREAK*', P.pos.clone().setY(2.5), '#ffb37a', 28); }
    }
    if (!on && c.on) c.mesh.position.y = 0.07;
    c.on = on;
  }
  P.hidden = !awake && inHide();

  // animate the avatar
  P.anim += hspd * dt * 2.2;
  const sw = Math.sin(P.anim) * clamp(hspd / 6, 0, 1) * 0.9;
  pm.g.position.copy(P.pos); pm.g.rotation.y = P.face;
  if (P.grounded) {
    pm.legL.rotation.x = sw; pm.legR.rotation.x = -sw; pm.armL.rotation.x = -sw; pm.armR.rotation.x = sw;
    pm.armL.rotation.z = pm.armR.rotation.z = 0;
  } else {
    pm.legL.rotation.x = 0.5; pm.legR.rotation.x = -0.3; pm.armL.rotation.x = pm.armR.rotation.x = -2.6;
  }
  pm.g.position.y += P.grounded ? Math.abs(Math.sin(P.anim)) * 0.08 * clamp(hspd / 6, 0, 1) : 0;
  const bs = 0.35 + Math.min(1, Math.sqrt(game.loot / 1420)) * 0.85;
  pm.bag.scale.setScalar(damp(pm.bag.scale.x, game.loot > 0 ? bs : 0.001, 10, dt));
  const gy = groundBelow(P.pos.x, P.pos.z, P.pos.y);
  pm.blob.position.set(P.pos.x, gy + 0.06, P.pos.z);
  pm.blob.scale.setScalar(clamp(1 - (P.pos.y - gy) * 0.15, 0.4, 1));

  // escape
  if (P.pos.z > ROOM.z1 - 0.7 && Math.abs(P.pos.x) < 1.2) {
    if (game.loot > 0 || awake) endRun(true);
    else if (!game.taught.empty) { game.taught.empty = true; tip("Don't leave empty-handed! Grab some treasure first.", 3); }
  }
}

// ---------------------------------------------------------------- stealing
let target = null;
function updateLoot(dt, t) {
  const c = new THREE.Vector3(P.pos.x, P.pos.y + 1, P.pos.z);
  target = null; let best = CFG.pickRange;
  for (const l of loot) {
    if (l.taken) continue;
    l.spin += dt * (l.d.kind === 'crown' ? 1.2 : 0.8);
    l.g.rotation.y = l.spin;
    l.g.position.y = l.d.p[1] + 0.08 + Math.sin(t * 2 + l.spin) * 0.08;
    l.gl.material.opacity = 0.35 + Math.sin(t * 3 + l.spin) * 0.12;
    const d = c.distanceTo(l.center);
    if (d < best) { best = d; target = l; }
  }
  const pr = $('prompt');
  if (target && game.phase === 'play' && G.mode !== 'grab') {
    const n = target.d.n * hearing(P.pos);
    const loud = n >= 30 ? 'VERY LOUD' : n >= 18 ? 'LOUD' : n >= 9 ? 'MEDIUM' : 'QUIET';
    const willWake = game.gstate < 3 && game.noise + n >= 100;
    pr.innerHTML = `<span class="k">${isTouch ? 'STEAL' : 'E'}</span>STEAL — ${target.d.name} <span style="color:#ffd54a">$${target.d.v}</span>` +
      (game.gstate < 3 ? `<small style="color:${willWake ? '#ff5a5a' : '#ddd'}">🔊 ${loud}${willWake ? ' — THIS WILL WAKE HIM!' : ''}</small>` : '');
    pr.classList.toggle('danger', willWake);
    pr.classList.remove('hidden');
    if (input.steal) steal(target);
  } else pr.classList.add('hidden');
  input.steal = false;

  // crown temptation
  crownBeam.visible = crownLight.visible = !loot[11].taken;
  crownBeam.material.opacity = 0.12 + Math.sin(t * 2.5) * 0.05;
  crownLight.intensity = 1.2 + Math.sin(t * 4) * 0.3;
  if (!loot[11].taken && Math.random() < dt * 6) burst(new THREE.Vector3(-15.5 + rand(-1, 1), 2.4 + rand(0, 1.5), -25 + rand(-1, 1)), 0xfff2a0, 1, 1, 0.8, 0.6);
  exitBeam.visible = game.loot > 0 || game.gstate >= 3;
  exitBeam.material.opacity = 0.1 + Math.sin(t * 3) * 0.04;
  exitPad.material.opacity = (exitBeam.visible ? 0.55 : 0.25) + Math.sin(t * 3) * 0.1;
}
function steal(l) {
  l.taken = true; l.g.visible = false; l.gl.visible = false;
  game.loot += l.d.v; game.items++;
  if (l.d.kind === 'crown') { game.crown = true; banner('👑 CROWN STOLEN! 👑', '#ffd54a'); game.flash = 0.25; }
  updateLootUI();
  const pos = l.center.clone();
  burst(pos, 0xffd54a, 14 + l.d.v / 20, 6, 0.9); burst(pos, 0xffffff, 6, 4, 0.6, 0.7);
  floatText('+$' + l.d.v, pos.clone().setY(pos.y + 1), '#ffd54a', 36 + Math.min(40, l.d.v / 12));
  SFX.pickup(l.d.v);
  game.fovKick = 4;
  addNoise(l.d.n * hearing(P.pos), P.pos);
}

// ---------------------------------------------------------------- noise + giant brain
function updateNoise(dt) {
  if (game.gstate >= 3) return;
  game.quietT += dt;
  if (game.quietT > CFG.noise.decayDelay) {
    game.noise = Math.max(0, game.noise - CFG.noise.decay * (P.hidden ? CFG.noise.hideMul : 1) * dt);
  }
  const n = game.noise, s = game.gstate, T = CFG.thr;
  if (n >= 100) { wake(); return; }
  if (s === 0 && n >= T.restless) setGiantState(1);
  else if (s === 1 && n >= T.susp) setGiantState(2);
  else if (s === 2 && n < T.suspOut) setGiantState(1);
  else if (s === 1 && n < T.restlessOut) game.gstate = 0;
  // heartbeat as he nears waking
  if (n > 55) {
    game.hbT -= dt;
    if (game.hbT <= 0) { SFX.heartbeat(0.25 + (n - 55) / 100); game.hbT = lerp(0.95, 0.38, (n - 55) / 45); }
  }
}

function updateGiant(dt, t) {
  const s = game.gstate;
  if (G.mode === 'sleep') {
    // breathing + snoring
    const period = s === 0 ? 4.2 : 3.2;
    const prevB = game.breath;
    game.breath += dt / period;
    if (Math.floor(game.breath) !== Math.floor(prevB) && s < 2) {
      SFX.snore(0.05 + 0.14 * clamp(1 - P.pos.distanceTo(EAR) / 70, 0, 1));
      spawnZ();
    }
    const bp = Math.sin(game.breath * Math.PI * 2);
    G.torso.scale.z = 1 + 0.06 * bp;
    G.mouth.scale.y = s < 2 ? 1 + 1.5 * Math.max(0, bp) : 0.6;
    // restless tossing
    if (s >= 1) {
      G.toss -= dt;
      if (G.toss <= 0 && s === 1) { G.rollT = rand(-0.16, 0.16); G.toss = rand(2.5, 5); SFX.grunt(0.12); }
    } else G.rollT = damp(G.rollT, 0, 0.6, dt);
    G.roll = damp(G.roll, G.rollT, 3, dt);
    G.raise = damp(G.raise, s === 2 ? 1 : s === 1 ? 0.15 : 0, s === 2 ? 4 : 2, dt);
    let eye = s === 2 ? 0.55 + game.noise / 250 : 0;
    if (s === 1 && Math.sin(t * 1.7) > 0.97) eye = 0.25; // peeks
    G.eye = damp(G.eye, eye, 8, dt);
    const dx = P.pos.x - EAR.x, dz = P.pos.z - EAR.z;
    G.look = damp(G.look, s === 2 ? clamp(Math.atan2(dx, dz), -1.1, 1.1) : Math.sin(t * 0.3) * 0.15, 3, dt);
    G.root.rotation.z = G.roll * 0.4;
    reclinePose(0.3 * G.raise);
    G.neck.rotation.x = 0.2 + 0.3 * G.raise;
    G.neck.rotation.z = G.roll * 1.5;
    G.neck.rotation.y = G.look;
    G.browL.rotation.z = -0.25 * G.raise; G.browR.rotation.z = 0.25 * G.raise;
    G.pupilMat.emissiveIntensity = s === 2 ? 0.6 : 0;
    setEyes(G.eye);
    return;
  }

  G.t += dt;
  const toPlayer = new THREE.Vector3(P.pos.x - G.root.position.x, 0, P.pos.z - G.root.position.z);
  const dist = toPlayer.length();
  if (G.mode === 'wake') {
    const w = G.t;
    setEyes(1); G.pupilMat.emissiveIntensity = 1.2;
    G.browL.rotation.z = -0.45; G.browR.rotation.z = 0.45;
    G.mouth.scale.set(1.3, 4, 1);
    G.root.rotation.z = damp(G.root.rotation.z, 0, 6, dt);
    G.neck.rotation.y = damp(G.neck.rotation.y, 0, 6, dt);
    const want = Math.atan2(toPlayer.x, toPlayer.z);
    if (w < 0.9) {
      reclinePose(0.55 * ease(w / 0.9));
      G.neck.rotation.x = 0.2; G.neck.rotation.z = 0;
      G.shL.rotation.set(-1.2, 0, -0.5); G.shR.rotation.set(-1.2, 0, 0.5);
      game.shake = Math.max(game.shake, 0.35);
    } else if (w < 1.7) {
      const k = ease((w - 0.9) / 0.8);
      G.body.rotation.x = lerp(RECLINE + 0.55, 0, k);
      G.hipL.rotation.x = G.hipR.rotation.x = lerp(-Math.PI / 2 - RECLINE - 0.55, 0, k);
      G.hipL.ankle.rotation.x = G.hipR.ankle.rotation.x = lerp(1.3, 0, k);
      G.neck.rotation.x = lerp(0.2, 0, k);
      G.root.position.lerpVectors(SLEEP_POS, new THREE.Vector3(0, 5, -18), k);
      G.root.rotation.y += wrapAng(want - G.root.rotation.y) * k * 0.1;
      if (w + dt >= 1.7) {
        G.from.copy(G.root.position);
        G.to.set(clamp(P.pos.x * 0.3, -6, 6), 0, -6);
      }
    } else if (w < 2.4) {
      const k = (w - 1.7) / 0.7;
      G.root.position.lerpVectors(G.from, G.to, k);
      G.root.position.y = lerp(G.from.y, 0, k) + Math.sin(k * Math.PI) * 6;
      G.root.rotation.y += wrapAng(want - G.root.rotation.y) * (1 - Math.exp(-4 * dt));
      G.hipL.rotation.x = -0.6; G.hipR.rotation.x = 0.3; G.shL.rotation.x = G.shR.rotation.x = -2.4;
    } else {
      G.root.position.y = 0;
      G.mode = 'chase'; G.t = 0; G.heading = G.root.rotation.y; G.stompCD = 2.2; G.stompT = -1; G.recover = 0.6;
      stomp(G.root.position, 1.2);
    }
    return;
  }

  if (G.mode === 'chase') {
    G.chaseT += dt;
    G.mouth.scale.set(1.3, 2.5 + Math.sin(t * 8), 1);
    const want = Math.atan2(toPlayer.x, toPlayer.z);
    const dh = wrapAng(want - G.heading);
    G.heading += clamp(dh, -CFG.giant.turn * dt, CFG.giant.turn * dt);
    G.root.rotation.y = G.heading;
    G.stompCD -= dt;
    if (G.stompT < 0 && G.stompCD <= 0 && dist < 22 && dist > 4) G.stompT = 0;
    let move = Math.min(CFG.giant.speedMax, CFG.giant.speed + G.chaseT * CFG.giant.accel);
    if (G.recover > 0) { G.recover -= dt; move = 0; G.shL.rotation.x = G.shR.rotation.x = -2.6; }
    if (G.stompT >= 0) {
      G.stompT += dt; move = 0;
      const k = G.stompT / 0.55;
      G.hipR.rotation.x = -1.1 * Math.sin(Math.min(1, k) * Math.PI * 0.5) * (k < 1 ? 1 : 0);
      G.hipL.rotation.x = 0.1;
      G.shL.rotation.x = G.shR.rotation.x = -0.4; G.shL.rotation.z = -0.6; G.shR.rotation.z = 0.6;
      if (k >= 1) {
        G.stompT = -1; G.stompCD = rand(2.6, 4); G.hipR.rotation.x = 0; G.shL.rotation.z = G.shR.rotation.z = 0;
        const fwd = new THREE.Vector3(Math.sin(G.heading), 0, Math.cos(G.heading));
        stomp(G.root.position.clone().addScaledVector(fwd, 3.5), 1);
      }
    } else {
      G.root.position.x += Math.sin(G.heading) * move * dt;
      G.root.position.z += Math.cos(G.heading) * move * dt;
      const prevPh = G.phase;
      G.phase += move * dt * 0.42;
      const sw = Math.sin(G.phase);
      G.hipL.rotation.x = sw * 0.6; G.hipR.rotation.x = -sw * 0.6;
      const reach = dist < 11 ? 1 : 0;
      G.shL.rotation.x = lerp(-sw * 0.6, -1.5, reach); G.shR.rotation.x = lerp(sw * 0.6, -1.5, reach);
      G.shL.rotation.z = G.shR.rotation.z = 0;
      G.root.position.y = Math.abs(Math.cos(G.phase)) * 0.5;
      if (Math.floor(prevPh / Math.PI) !== Math.floor(G.phase / Math.PI)) {
        const v = clamp(1 - dist / 45, 0.1, 1);
        SFX.thud(0.25 + v * 0.4); game.shake = Math.max(game.shake, v * 0.35);
      }
    }
    G.root.position.x = clamp(G.root.position.x, ROOM.x0 + 4, ROOM.x1 - 4);
    G.root.position.z = clamp(G.root.position.z, ROOM.z0 + 4, ROOM.z1 - 3);
    // catch
    const facing = (Math.sin(G.heading) * toPlayer.x + Math.cos(G.heading) * toPlayer.z) / Math.max(dist, 0.001);
    if (game.phase === 'play' && G.recover <= 0 && P.pos.y < 6 && (dist < CFG.giant.grabR || (dist < CFG.giant.catchR && facing > 0.2))) {
      G.mode = 'grab'; G.t = 0; SFX.laugh(); game.shake = 0.6; game.tipT = 0; $('tip').style.opacity = 0;
      SFX.stopChase();
      banner('CAUGHT!');
    }
    return;
  }

  if (G.mode === 'grab') {
    // turn toward the open room and lift the thief up to his face
    const v = grabDir();
    G.heading += wrapAng(Math.atan2(v.x, v.z) - G.heading) * (1 - Math.exp(-5 * dt));
    G.root.rotation.y = G.heading;
    G.root.position.y = damp(G.root.position.y, 0, 8, dt);
    G.shR.rotation.x = damp(G.shR.rotation.x, -1.75, 6, dt); G.shR.rotation.z = damp(G.shR.rotation.z, 0.35, 6, dt);
    G.shL.rotation.x = damp(G.shL.rotation.x, -0.3, 6, dt);
    G.hipL.rotation.x = G.hipR.rotation.x = 0;
    const hand = new THREE.Vector3(); G.shR.children[1].getWorldPosition(hand);
    pm.g.position.lerp(hand.add(new THREE.Vector3(0, 2.2, 0)), 1 - Math.exp(-8 * dt));
    pm.g.rotation.y = G.heading + Math.PI;
    pm.legL.rotation.x = Math.sin(t * 20) * 0.8; pm.legR.rotation.x = -Math.sin(t * 20) * 0.8;
    if (G.t > 1.4 && game.phase === 'play') endRun(false);
  }
}

function grabDir() {
  const x = -G.root.position.x, z = -5 - G.root.position.z, l = Math.hypot(x, z);
  return l < 1 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(x / l, 0, z / l);
}
function stomp(pos, power) {
  SFX.stomp(0.6 * power);
  const d = Math.hypot(P.pos.x - pos.x, P.pos.z - pos.z);
  game.shake = Math.max(game.shake, power * clamp(1.3 - d / 30, 0.25, 1.2));
  const m = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xfff0c0, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.set(pos.x, 0.1, pos.z); scene.add(m);
  waves.push({ m, x: pos.x, z: pos.z, r: 0.5, max: 15, hit: false });
  burst(new THREE.Vector3(pos.x, 0.3, pos.z), 0xd9c6a0, 22, 8, 0.7, 1.4);
}
function updateWaves(dt) {
  for (let i = waves.length - 1; i >= 0; i--) {
    const w = waves[i];
    const prevR = w.r; w.r += 20 * dt;
    w.m.scale.setScalar(w.r); w.m.material.opacity = 0.85 * (1 - w.r / w.max);
    const d = Math.hypot(P.pos.x - w.x, P.pos.z - w.z);
    if (!w.hit && d > prevR - 0.6 && d <= w.r + 0.6 && game.phase === 'play' && G.mode !== 'grab') {
      w.hit = true;
      if (P.pos.y < 0.35) {
        P.slowT = 0.8; P.vy = 6; P.grounded = false;
        P.vel.x += (P.pos.x - w.x) / Math.max(d, 0.1) * 6; P.vel.z += (P.pos.z - w.z) / Math.max(d, 0.1) * 6;
        floatText('STUMBLED!', P.pos.clone().setY(2.6), '#ff8a5a', 30);
      } else floatText('JUMPED IT!', P.pos.clone().setY(2.6), '#6dff8f', 30);
    }
    if (w.r >= w.max) { scene.remove(w.m); waves.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- fx update
const tmpV = new THREE.Vector3();
function updateFx(dt, t) {
  for (const p of parts) {
    if (p.life <= 0) continue;
    p.life -= dt; p.v.y -= 18 * dt;
    p.m.position.addScaledVector(p.v, dt);
    if (p.m.position.y < 0.1) { p.m.position.y = 0.1; p.v.multiplyScalar(0.5); p.v.y = Math.abs(p.v.y) * 0.4; }
    p.m.rotation.x += dt * 6; p.m.rotation.y += dt * 5;
    p.m.scale.setScalar(p.size * Math.max(0.01, Math.min(1, p.life / p.max * 1.5)));
    if (p.life <= 0) p.m.visible = false;
  }
  for (let i = rings.length - 1; i >= 0; i--) {
    const r = rings[i]; r.t += dt; const k = r.t / r.dur;
    r.m.scale.setScalar(0.3 + r.maxR * ease(Math.min(1, k)));
    r.m.material.opacity = r.opacity * (1 - k);
    if (k >= 1) { scene.remove(r.m); r.m.material.dispose(); rings.splice(i, 1); }
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i]; f.t += dt; f.p.y += dt * 1.6;
    tmpV.copy(f.p).project(camera);
    const k = f.t / f.life;
    f.el.style.left = ((tmpV.x * 0.5 + 0.5) * innerWidth) + 'px';
    f.el.style.top = ((-tmpV.y * 0.5 + 0.5) * innerHeight) + 'px';
    f.el.style.opacity = tmpV.z < 1 ? String(1 - Math.max(0, k - 0.6) / 0.4) : '0';
    f.el.style.transform = `translate(-50%,-50%) scale(${k < 0.15 ? 0.5 + k / 0.15 * 0.8 : 1.3 - Math.min(0.3, (k - 0.15))})`;
    if (k >= 1) { f.el.remove(); floaters.splice(i, 1); }
  }
  for (let i = zzz.length - 1; i >= 0; i--) {
    const z = zzz[i]; z.t += dt;
    z.s.position.y += dt * 1.6; z.s.position.x += Math.sin(z.t * 2) * dt * 0.8 + z.dx * dt;
    z.s.scale.set(1.4 + z.t, 0.7 + z.t * 0.5, 1);
    z.s.material.opacity = Math.max(0, 1 - z.t / 3);
    if (z.t > 3 || G.mode !== 'sleep') { scene.remove(z.s); z.s.material.dispose(); zzz.splice(i, 1); }
  }
  for (const c of candles) {
    const f = 0.85 + Math.sin(t * 13 + c.seed) * 0.08 + Math.sin(t * 7.3 + c.seed * 2) * 0.07;
    c.light.intensity = f * 0.8; c.flame.scale.set(1, f * 1.1, 1);
  }
  // grandfather clock
  pendulum.rotation.z = Math.sin(t * Math.PI) * 0.35;
  game.tickT += dt;
  if (game.tickT >= 1) { game.tickT -= 1; game.tock = !game.tock; if (G.mode === 'sleep') SFX.tick(game.tock); }
}

// ---------------------------------------------------------------- HUD
function updateHUD(dt) {
  const s = game.gstate;
  $('meterFill').style.width = game.noise.toFixed(1) + '%';
  $('meterWrap').className = 'o ' + CLASSES[s];
  $('state').textContent = STATE_NAMES[s];
  $('state').style.color = ['#bfffd0', '#ffe680', '#ff9a4a', '#ff4a4a'][s];
  const w = $('warn');
  if (s === 3) { w.textContent = G.mode === 'grab' ? '' : '🏃 RUN TO THE EXIT! 🏃'; w.className = 'o blink'; }
  else if (s === 2) { w.textContent = "👁 HE'S WATCHING — DON'T MOVE!"; w.className = 'o blink'; }
  else w.textContent = '';
  $('status').textContent = P.hidden && s < 3 ? '🫥 HIDDEN — he calms down faster' : '';
  const m = hearing(P.pos);
  const lvl = m < 0.8 ? 1 : m < 1.15 ? 2 : m < 1.45 ? 3 : 4;
  $('hearing').innerHTML = s < 3 ? '👂 HE HEARS: ' + '<span style="color:#ff7a5a">' + '▮'.repeat(lvl) + '</span><span style="opacity:.35">' + '▮'.repeat(4 - lvl) + '</span>' : '';
  let v = 0;
  if (s === 3) v = 0.55 + Math.sin(performance.now() / 120) * 0.15;
  else if (game.noise > 55) v = (game.noise - 55) / 45 * (0.75 + Math.sin(performance.now() / (s === 2 ? 90 : 200)) * 0.25);
  $('vignette').style.opacity = v;
  game.flash = Math.max(0, game.flash - dt * 2);
  $('flash').style.opacity = game.flash;
  if (game.tipT > 0) { game.tipT -= dt; if (game.tipT <= 0) $('tip').style.opacity = 0; }
  $('lockHint').classList.toggle('hidden', locked || isTouch || game.phase !== 'play');
  // where is he? edge-of-screen arrow while he chases you
  const dEl = $('danger');
  if (G.mode === 'chase' && game.phase === 'play') {
    tmpV.copy(G.root.position); tmpV.y += 14; tmpV.project(camera);
    let x = tmpV.x, y = tmpV.y; const behind = tmpV.z > 1;
    if (behind) { x = clamp(-x, -0.8, 0.8); y = -1.5; }
    const dist = Math.hypot(P.pos.x - G.root.position.x, P.pos.z - G.root.position.z);
    if (behind || Math.abs(x) > 0.9 || Math.abs(y) > 0.9) {
      const a = Math.atan2(y, x);
      dEl.style.left = (0.5 + Math.cos(a) * 0.44) * innerWidth + 'px';
      dEl.style.top = (0.5 - Math.sin(a) * 0.38) * innerHeight + 'px';
      $('dArrow').style.transform = `rotate(${-a + Math.PI / 2}rad)`;
      $('dDist').textContent = Math.round(dist) + 'm' + (behind ? ' BEHIND YOU' : '');
      dEl.style.fontSize = (dist < 15 ? 30 : 22) + 'px';
      dEl.classList.remove('hidden');
    } else dEl.classList.add('hidden');
  } else dEl.classList.add('hidden');
}

// ---------------------------------------------------------------- camera
const ray = new THREE.Raycaster();
const camTarget = new THREE.Vector3(0, 1.7, 35);
let camDist = 7, freeCam = null;
function updateCamera(dt, t) {
  if (freeCam) { camera.position.set(freeCam[0], freeCam[1], freeCam[2]); camera.lookAt(freeCam[3], freeCam[4], freeCam[5]); return; }
  if (G.mode === 'grab') {
    // face-to-face with the Giant, thief dangling in his fist
    const head = G.neck.getWorldPosition(new THREE.Vector3()); head.y += 4;
    const v = grabDir();
    const pp = pm.g.position;
    const want = new THREE.Vector3(pp.x + v.x * 10 + v.z * 2.5, pp.y + 3.5, pp.z + v.z * 10 - v.x * 2.5);
    want.x = clamp(want.x, ROOM.x0 + 1, ROOM.x1 - 1); want.z = clamp(want.z, ROOM.z0 + 1, ROOM.z1 - 2);
    camera.position.lerp(want, 1 - Math.exp(-4 * dt));
    camera.lookAt(lerp(pp.x, head.x, 0.35), lerp(pp.y, head.y, 0.35), lerp(pp.z, head.z, 0.35));
    yaw = Math.atan2(v.x, v.z);
    return;
  }
  const tx = P.pos.x, ty = P.pos.y, tz = P.pos.z;
  camTarget.x = damp(camTarget.x, tx, 20, dt);
  camTarget.z = damp(camTarget.z, tz, 20, dt);
  camTarget.y = damp(camTarget.y, ty + 2.6, 10, dt);
  const want = game.gstate >= 3 ? 11 : 8.5;
  const dir = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
  ray.set(camTarget, dir); ray.far = want;
  const hit = ray.intersectObjects(camBlockers, false)[0];
  const d = hit ? Math.max(1.2, hit.distance - 0.4) : want;
  camDist = d < camDist ? d : damp(camDist, d, 4, dt);
  camera.position.copy(camTarget).addScaledVector(dir, camDist);
  camera.position.x = clamp(camera.position.x, ROOM.x0 + 0.3, ROOM.x1 - 0.3);
  camera.position.z = clamp(camera.position.z, ROOM.z0 + 0.3, ROOM.z1 - 1.6);
  camera.position.y = clamp(camera.position.y, 0.4, ROOM.h - 0.5);
  camera.lookAt(camTarget);
  game.shake = Math.max(0, game.shake - dt * 1.8);
  if (game.shake > 0) {
    const s = game.shake * game.shake * 0.6;
    camera.position.x += Math.sin(t * 61) * s; camera.position.y += Math.sin(t * 53 + 1) * s; camera.position.z += Math.sin(t * 47 + 2) * s;
  }
  game.fovKick = damp(game.fovKick, 0, 6, dt);
  const fov = (game.gstate >= 3 ? 74 : 65) + game.fovKick;
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 5, dt); camera.updateProjectionMatrix(); }
}

// ---------------------------------------------------------------- main loop
giantSleepPose(); setEyes(0);
P.pos.set(0, 0, 35); pm.g.position.copy(P.pos); pm.g.rotation.y = Math.PI;
let last = performance.now(), time = 0;
function frame(now) {
  requestAnimationFrame(frame);
  tick(Math.min(0.05, (now - last) / 1000)); last = now;
  renderer.render(scene, camera);
}
function tick(dt) {
  time += dt;
  if (game.phase === 'title') {
    // slow orbit showing the room and the sleeping Giant
    yaw = Math.sin(time * 0.15) * 0.5; pitch = 0.42;
    updateGiant(dt, time);
  } else if (game.phase === 'play') {
    game.runT += dt;
    if (G.mode !== 'grab') updatePlayer(dt);
    updateNoise(dt);
    updateGiant(dt, time);
    updateWaves(dt);
  } else {
    game.endT += dt;
    if (G.mode === 'grab') updateGiant(dt, time);
  }
  updateLoot(dt, time);
  updateFx(dt, time);
  updateHUD(dt);
  updateCamera(dt, time);
}
requestAnimationFrame(frame);

// tuning/debug hook (used by automated playtests)
window.__dwtg = { game, P, G, pm, camera, loot, startRun, steal, wake, addNoise, keys, input,
  step: (n, dt = 1 / 60) => { for (let i = 0; i < n; i++) tick(dt); renderer.render(scene, camera); }, cam: (y, p) => { yaw = y; pitch = p; },
  freeCam: (x, y, z, lx, ly, lz) => { freeCam = [x, y, z, lx, ly, lz]; }, view: () => ({ yaw, pitch, locked }) };
})();
