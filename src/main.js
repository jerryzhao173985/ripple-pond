import * as THREE from 'three';
import { makeTileTexture } from './tiles.js';
import { bakeCausticTexture } from './caustics.js';
import { WaterSim } from './sim.js';
import { WaterSurface } from './water.js';
import { Underwater } from './underwater.js';
import { Game } from './game.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { Audio } from './audio.js';
import { LEVELS } from './levels.js';

const ui = new UI();

// ---------- capability guard ----------
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (e) {
  ui.fatal('WebGL is not available in this browser.');
  throw e;
}
const gl = renderer.getContext();
const isWebGL2 = renderer.capabilities.isWebGL2;
const floatOK = isWebGL2 && !!gl.getExtension('EXT_color_buffer_float');
if (!floatOK) {
  ui.fatal('This pool needs WebGL2 with float render targets (EXT_color_buffer_float). Try a recent Chrome, Edge, Firefox or Safari.');
  throw new Error('No float render target support');
}

const MAX_DPR = 2;                         // full Retina sharpness (baked caustics keep it 60fps)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));
renderer.setClearColor(0x1f9fdd, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---------- scene / camera ----------
const BOUNDS = 22;                       // world size of the (square) pool plane
const GRID = (window.innerWidth < 700) ? 192 : 256;
const VIEW = 15;                         // world units across the shorter viewport side (less zoom)

const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
camera.position.set(0, 0, 20);
camera.lookAt(0, 0, 0);

// ---------- lights (for the duck; water is shader-lit) ----------
const sun = new THREE.Vector3(0.45, 0.5, 0.75).normalize();
const dir = new THREE.DirectionalLight(0xffffff, 1.35);
dir.position.copy(sun).multiplyScalar(10);
scene.add(dir);
scene.add(new THREE.AmbientLight(0xdff2ff, 1.0));

// ---------- world objects ----------
const floorTex = makeTileTexture(renderer, { tilesAcross: 18, size: 2048 });
const causticTex = bakeCausticTexture(renderer, 1024);
const sim = new WaterSim(renderer, { grid: GRID, bounds: BOUNDS, viscosity: 0.975, substeps: 3 });
const water = new WaterSurface({ floorTex, causticTex, grid: GRID, bounds: BOUNDS });
water.uniforms.uSun.value.copy(sun);
scene.add(water.mesh);

const underwater = new Underwater(renderer, { bounds: BOUNDS, size: 1024 });
water.uniforms.uFishTex.value = underwater.texture;

const audio = new Audio();
const game = new Game({ scene, sim, ui, audio, bounds: BOUNDS });
game.attachUnderwater(underwater);

// Throw aim guide — a faint streak from the duck along the drag direction while held.
const aimGeo = new THREE.PlaneGeometry(1, 0.14);
aimGeo.translate(0.5, 0, 0);   // pivot at the duck end so scaling extends forward
const aim = new THREE.Mesh(aimGeo, new THREE.MeshBasicMaterial({
  color: 0x9fe8ff, transparent: true, opacity: 0, depthWrite: false,
}));
aim.visible = false; aim.renderOrder = 2;
scene.add(aim);
game.aim = aim;

// ---------- controller for UI ----------
const controller = {
  playLevel: (i) => game.startLevel(i),
  startSandbox: () => game.startSandbox(),
  startHunt: () => game.startHunt(4),
  restart: () => game.restart(),
  nextLevel: () => game.nextLevel(),
  toMenu: () => game.toMenu(),
  addSandboxDuck: () => game.addSandboxDuck(),
  calm: () => sim.calm(),
  getProgress: () => game.progress,
  firstUnplayed: () => Math.min(LEVELS.length - 1, Math.max(0, game.progress.unlocked - 1)),
};
ui.bind(controller);

new Input({ canvas, camera, waterMesh: water.mesh, sim, game, audio });

// ---------- resize / cover scaling ----------
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DPR));

  const aspect = w / h;
  let halfH, halfW;
  if (aspect >= 1) { halfH = VIEW / 2; halfW = halfH * aspect; }
  else { halfW = VIEW / 2; halfH = halfW / aspect; }
  // Never show beyond the pool plane.
  halfW = Math.min(halfW, BOUNDS / 2);
  halfH = Math.min(halfH, BOUNDS / 2);

  camera.left = -halfW; camera.right = halfW;
  camera.top = halfH; camera.bottom = -halfH;
  camera.updateProjectionMatrix();

  const margin = 0.7;
  const limX = halfW - margin, limY = halfH - margin;
  const placeScale = Math.min(limX, limY) * 0.94;
  game.setPlayArea(limX, limY, placeScale);
}
window.addEventListener('resize', resize);
resize();

// Pre-warm: upload pooled entity geometries once (to a tiny offscreen target, no visible
// flash) so the FIRST level load doesn't hitch while uploading meshes.
(function prewarm() {
  const scratch = new THREE.WebGLRenderTarget(4, 4);
  const pools = [...game.ducklingPool, ...game.obstaclePool, ...game.drainPool];
  for (const p of pools) { p.group.visible = true; if (p.shadow) p.shadow.visible = true; }
  renderer.setRenderTarget(scratch);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  for (const p of pools) { p.group.visible = false; if (p.shadow) p.shadow.visible = false; }
  scratch.dispose();
})();

// ---------- ambient idle ripples (keep the surface alive like the video) ----------
let nextDrop = 0;
function ambient(time) {
  if (time > nextDrop) {
    sim.inject(0.1 + Math.random() * 0.8, 0.1 + Math.random() * 0.8, -0.006, 0.035);
    nextDrop = time + 1.6 + Math.random() * 2.0;
  }
}

// ---------- main loop (fixed-timestep sim + real-dt render) ----------
ui.showMenu();
game.toMenu();

const SIM_DT = 1 / 60;
let acc = 0;
let prev = performance.now() / 1000;
let MAXSUB = 3;

function frame(nowMs) {
  const now = nowMs / 1000;
  let dt = now - prev;
  prev = now;
  if (dt > 0.1) dt = 0.1;          // tab-switch guard
  const time = now;

  ambient(time);

  // Step the wave on fixed ticks (decoupled from FPS).
  acc += dt;
  let steps = 0;
  while (acc >= SIM_DT && steps < MAXSUB) { sim.step(); acc -= SIM_DT; steps++; }
  if (acc > SIM_DT * 4) acc = 0;   // don't spiral after a stall

  // Game physics + entity placement (reads back water level once per frame).
  game.update(dt, time);

  // Render the underwater (fish) layer to its texture, then the main pass.
  underwater.render();
  water.update(time, sim.heightTexture);
  renderer.render(scene, camera);

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Expose a few handles for debugging / automated verification.
window.__pond = { sim, water, game, camera, renderer, scene, THREE };
