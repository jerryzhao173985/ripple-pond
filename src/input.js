import * as THREE from 'three';

/**
 * Pointer/touch input with two intents from one gesture:
 *   • press ON the duck  → GRAB it; drag to move with inertia; release to THROW.
 *   • press on the water → a probing RIPPLE (tone-burst) to peer into the depths; drag = trail.
 * Both disturb the surface (which later scares the fish).
 */
export class Input {
  constructor({ canvas, camera, waterMesh, sim, game, audio }) {
    this.camera = camera;
    this.waterMesh = waterMesh;
    this.sim = sim;
    this.game = game;
    this.audio = audio;
    this.canvas = canvas;

    this.ray = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.grabbing = false;
    this.dragging = false;
    this.lastUv = null;

    // Flick tracking for crisp, velocity-based throws.
    this.flick = new THREE.Vector2();
    this._lastW = new THREE.Vector2();
    this._lastMoveT = 0;

    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);

    canvas.addEventListener('pointerdown', this._onDown, { passive: false });
    window.addEventListener('pointermove', this._onMove, { passive: false });
    window.addEventListener('pointerup', this._onUp, { passive: false });
    window.addEventListener('pointercancel', this._onUp, { passive: false });
  }

  _hit(e) {
    const r = this.canvas.getBoundingClientRect();
    this.ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.ray.setFromCamera(this.ndc, this.camera);
    const h = this.ray.intersectObject(this.waterMesh, false)[0];
    return h ? h.uv : null;
  }

  _world(uv) {
    return { wx: (uv.x - 0.5) * this.game.bounds, wy: (uv.y - 0.5) * this.game.bounds };
  }

  _onDown(e) {
    const uv = this._hit(e);
    if (!uv) return;
    this.audio?.resume();
    const { wx, wy } = this._world(uv);

    if (this.game.tryGrab(wx, wy)) {
      this.grabbing = true;
      this.flick.set(0, 0);
      this._lastW.set(wx, wy);
      this._lastMoveT = performance.now();
      this.sim.tap(uv.x, uv.y, -0.05, 0.05);     // small splash on grab
    } else {
      this.dragging = true;
      this.sim.tap(uv.x, uv.y, -0.12, 0.06);     // probing ripple
      this.game.registerStroke();
      this.game.onTap(uv);
    }
    this.lastUv = uv;
    this.audio?.plip();
  }

  _onMove(e) {
    const uv = this._hit(e);
    if (!uv) return;
    if (this.grabbing) {
      const { wx, wy } = this._world(uv);
      const now = performance.now();
      const dt = Math.max(0.001, (now - this._lastMoveT) / 1000);
      const ivx = (wx - this._lastW.x) / dt, ivy = (wy - this._lastW.y) / dt;
      this.flick.set(this.flick.x * 0.4 + ivx * 0.6, this.flick.y * 0.4 + ivy * 0.6); // smoothed flick
      this._lastW.set(wx, wy);
      this._lastMoveT = now;
      this.game.dragDuck(wx, wy);
    } else if (this.dragging) {
      this.sim.inject(uv.x, uv.y, -0.032, 0.05);  // ripple trail
    } else if (this.lastUv) {
      const d = Math.hypot(uv.x - this.lastUv.x, uv.y - this.lastUv.y);
      if (d > 0.012) this.sim.inject(uv.x, uv.y, -0.008, 0.035); // gentle hover ripple
    }
    this.lastUv = uv;
  }

  _onUp() {
    if (this.grabbing) {
      // If the pointer was held still before release, it's a soft drop (no flick).
      const idle = (performance.now() - this._lastMoveT) > 110;
      this.game.releaseDuck(idle ? 0 : this.flick.x, idle ? 0 : this.flick.y);
      this.grabbing = false;
    }
    this.dragging = false;
  }
}
