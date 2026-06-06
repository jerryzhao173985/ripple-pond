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
    if (this.grabbing) { this.game.releaseDuck(); this.grabbing = false; }
    this.dragging = false;
  }
}
