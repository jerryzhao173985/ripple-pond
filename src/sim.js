import * as THREE from 'three';
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';

/**
 * WaterSim — GPU height-field water simulation.
 *
 * Solves the damped 2-D wave equation  ∂²h/∂t² + a·∂h/∂t = c²∇²h  with an explicit leapfrog
 * (FDTD), ping-ponged via GPUComputationRenderer. R = h(t), G = h(t-Δt).
 *
 * Update (Courant² = 0.5 = the 2-D CFL limit, so the +2h/−4h terms cancel):
 *      h_new = ( N + S + E + W ) * 0.5  −  h_prev ,   then  × viscosity
 *
 * Disturbances are injected as up to MAX_SRC simultaneous "sources" per step, each a
 * **Mexican-hat** (Laplacian-of-Gaussian) profile `(1−x²)·e^(−x²)` — a dip ringed by a crest,
 * i.e. a real water-drop shape that radiates concentric rings. A `tap()` registers an
 * *oscillating* emitter (a damped tone-burst over several frames) → a train of several rings.
 *
 * A second tiny pass (readWaterLevel) samples height + gradient at each floating body's UV and
 * is read back to the CPU in ONE call for buoyancy.
 */

const MAX_BODIES = 16;
const MAX_SRC = 8;

const heightmapFrag = /* glsl */`
  #define MAX_SRC ${MAX_SRC}
  uniform vec2  uSrc[ MAX_SRC ];      // source centers (uv)
  uniform vec2  uAmpSize[ MAX_SRC ];  // x = signed amplitude, y = radius (uv)
  uniform float uViscosity;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution.xy;
    vec2 texel = 1.0 / resolution.xy;

    vec4 h = texture2D( heightmap, uv );
    float n = texture2D( heightmap, uv + vec2( 0.0,  texel.y ) ).x;
    float s = texture2D( heightmap, uv + vec2( 0.0, -texel.y ) ).x;
    float e = texture2D( heightmap, uv + vec2(  texel.x, 0.0 ) ).x;
    float w = texture2D( heightmap, uv + vec2( -texel.x, 0.0 ) ).x;

    float newH = ( n + s + e + w ) * 0.5 - h.y;
    newH *= uViscosity;

    for ( int k = 0; k < MAX_SRC; k++ ) {
      float amp = uAmpSize[ k ].x;
      if ( amp != 0.0 ) {
        float x = distance( uv, uSrc[ k ] ) / uAmpSize[ k ].y;
        float infl = ( 1.0 - x * x ) * exp( -x * x );   // Mexican-hat: dip + ring
        newH += amp * infl;
      }
    }

    h.y = h.x;
    h.x = newH;
    gl_FragColor = h;
  }
`;

const levelFrag = /* glsl */`
  #define MAX_BODIES ${MAX_BODIES}
  uniform sampler2D uHeight;
  uniform vec2  uPoints[ MAX_BODIES ];
  uniform vec2  uTexel;
  uniform float uGradScale;

  void main() {
    int idx = int( floor( gl_FragCoord.x ) );
    vec2 uv = vec2( 0.5 );
    for ( int i = 0; i < MAX_BODIES; i++ ) { if ( i == idx ) uv = uPoints[ i ]; }

    float h  = texture2D( uHeight, uv ).x;
    float hl = texture2D( uHeight, uv - vec2( uTexel.x, 0.0 ) ).x;
    float hr = texture2D( uHeight, uv + vec2( uTexel.x, 0.0 ) ).x;
    float hd = texture2D( uHeight, uv - vec2( 0.0, uTexel.y ) ).x;
    float hu = texture2D( uHeight, uv + vec2( 0.0, uTexel.y ) ).x;

    float nx = ( hl - hr ) * uGradScale;
    float ny = ( hd - hu ) * uGradScale;
    gl_FragColor = vec4( h, nx, ny, 1.0 );
  }
`;

export class WaterSim {
  constructor(renderer, { grid = 256, bounds = 12, viscosity = 0.975, substeps = 3 } = {}) {
    this.renderer = renderer;
    this.grid = grid;
    this.bounds = bounds;
    this.substeps = substeps;

    const gpu = new GPUComputationRenderer(grid, grid, renderer);
    this.gpu = gpu;

    const tex = gpu.createTexture();
    this.heightVar = gpu.addVariable('heightmap', heightmapFrag, tex);
    gpu.setVariableDependencies(this.heightVar, [this.heightVar]);

    const u = this.heightVar.material.uniforms;
    u.uSrc = { value: Array.from({ length: MAX_SRC }, () => new THREE.Vector2()) };
    u.uAmpSize = { value: Array.from({ length: MAX_SRC }, () => new THREE.Vector2(0, 0.05)) };
    u.uViscosity = { value: viscosity };

    const err = gpu.init();
    if (err !== null) throw new Error('GPUComputationRenderer init failed: ' + err);

    // --- Buoyancy readback pass ---
    this.levelRT = gpu.createRenderTarget(
      MAX_BODIES, 1,
      THREE.ClampToEdgeWrapping, THREE.ClampToEdgeWrapping,
      THREE.NearestFilter, THREE.NearestFilter
    );
    this.levelMat = gpu.createShaderMaterial(levelFrag, {
      uHeight: { value: null },
      uPoints: { value: Array.from({ length: MAX_BODIES }, () => new THREE.Vector2(0.5, 0.5)) },
      uTexel: { value: new THREE.Vector2(1 / grid, 1 / grid) },
      uGradScale: { value: grid / bounds },
    });
    this.levelBuffer = new Float32Array(MAX_BODIES * 4);

    this._emitters = [];
  }

  get heightTexture() {
    return this.gpu.getCurrentRenderTarget(this.heightVar).texture;
  }

  /** One-shot ripple pulse (drag trail, ambient). uv in 0..1; strength signed. */
  inject(uvx, uvy, strength, sizeUv = 0.05) {
    if (this._emitters.length > 40) this._emitters.shift();
    this._emitters.push({ x: uvx, y: uvy, age: 0, life: 1, amp: strength, size: sizeUv, freq: 0 });
  }

  /** A touch: an oscillating tone-burst → a train of concentric rings. */
  tap(uvx, uvy, amp = -0.11, sizeUv = 0.06) {
    if (this._emitters.length > 40) this._emitters.shift();
    this._emitters.push({ x: uvx, y: uvy, age: 0, life: 8, amp, size: sizeUv, freq: 0.85 });
  }

  step() {
    const u = this.heightVar.material.uniforms;
    const src = u.uSrc.value;
    const as = u.uAmpSize.value;

    // Substep 0: inject all active emitters (most-recent first, capped at MAX_SRC).
    let used = 0;
    for (let i = this._emitters.length - 1; i >= 0 && used < MAX_SRC; i--) {
      const em = this._emitters[i];
      let a = em.amp;
      if (em.freq > 0) a *= Math.cos(em.age * em.freq) * Math.max(0, 1 - em.age / em.life);
      src[used].set(em.x, em.y);
      as[used].set(a, em.size);
      used++;
    }
    for (let k = used; k < MAX_SRC; k++) as[k].set(0, 0.05);
    this.gpu.compute();

    // Remaining substeps: propagate only (no injection).
    for (let k = 0; k < MAX_SRC; k++) as[k].set(0, 0.05);
    for (let i = 1; i < this.substeps; i++) this.gpu.compute();

    // Age + cull emitters.
    for (let i = this._emitters.length - 1; i >= 0; i--) {
      if (++this._emitters[i].age >= this._emitters[i].life) this._emitters.splice(i, 1);
    }
  }

  /**
   * Sample height + surface normal at each body UV (one batched readback).
   * @returns {Array<{height:number,nx:number,ny:number}>}
   */
  sampleBodies(uvs) {
    const pts = this.levelMat.uniforms.uPoints.value;
    const count = Math.min(uvs.length, MAX_BODIES);
    for (let i = 0; i < count; i++) pts[i].set(uvs[i].x, uvs[i].y);
    this.levelMat.uniforms.uHeight.value = this.heightTexture;

    this.gpu.doRenderTarget(this.levelMat, this.levelRT);
    this.renderer.readRenderTargetPixels(this.levelRT, 0, 0, MAX_BODIES, 1, this.levelBuffer);

    const out = [];
    for (let i = 0; i < count; i++) {
      out.push({
        height: this.levelBuffer[i * 4 + 0],
        nx: this.levelBuffer[i * 4 + 1],
        ny: this.levelBuffer[i * 4 + 2],
      });
    }
    return out;
  }

  /** Gradually flatten the surface (Sandbox "Calm"). */
  calm() {
    this._emitters.length = 0;
    const u = this.heightVar.material.uniforms;
    const prev = u.uViscosity.value;
    u.uViscosity.value = 0.0;
    this.gpu.compute(); this.gpu.compute();
    u.uViscosity.value = prev;
  }

  setViscosity(v) { this.heightVar.material.uniforms.uViscosity.value = v; }
}

export { MAX_BODIES };
