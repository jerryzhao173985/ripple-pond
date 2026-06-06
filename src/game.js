import * as THREE from 'three';
import { FloatingBody, makeDuck } from './duck.js';
import { makeDuckling, makeGoalRing, makeDrain, makeObstacle } from './entities.js';
import { Fish, makeFish, DisturbanceMemory } from './fish.js';
import { LEVELS } from './levels.js';

const PROGRESS_KEY = 'ripplepond.progress.v1';

/** Free a removed object's GPU resources (geometries + materials). Shared textures are
 *  module-cached singletons, so we deliberately do NOT dispose maps here. */
function disposeTree(obj) {
  if (!obj) return;
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) m.dispose();
    }
  });
}

export class Game {
  constructor({ scene, sim, ui, audio, bounds }) {
    this.scene = scene;
    this.sim = sim;
    this.ui = ui;
    this.audio = audio;
    this.bounds = bounds;

    this.mode = 'menu';           // 'menu' | 'play' | 'sandbox'
    this.levelIndex = 0;
    this.strokes = 0;
    this.time = 0;
    this.won = false;

    this.limX = bounds * 0.5;
    this.limY = bounds * 0.5;
    this.placeScale = bounds * 0.4;

    // Player duck (used in both play and sandbox).
    const d = makeDuck({ scale: 1.5 });
    this.playerVisual = d;
    scene.add(d.shadow, d.group);
    this.player = new FloatingBody(d.group, {
      bounds, radius: 1.0, floatOffset: 0.2, shadow: d.shadow,
      drag: 0.62, push: 10.0, tiltAmt: 0.5, bobAmp: 0.055, bobRate: 1.8,
    });
    this._lastWake = 0;

    this.ducklings = [];   // active subset (references into the pools below)
    this.obstacles = [];
    this.drains = [];
    this.extraDucks = [];

    this.goal = makeGoalRing();
    scene.add(this.goal.group);

    // Pre-built entity pools (max across all levels) — reused per level so starting a
    // level never allocates geometry (no GC/upload hitch). Hidden until needed.
    const hide = (...objs) => objs.forEach((o) => { if (o) o.visible = false; });
    this.ducklingPool = [];
    for (let i = 0; i < 4; i++) {
      const d = makeDuckling({ bounds, limX: this.limX, limY: this.limY });
      scene.add(d.shadow, d.group); hide(d.group, d.shadow);
      this.ducklingPool.push(d);
    }
    this.obstaclePool = [];
    for (let i = 0; i < 3; i++) {
      const o = makeObstacle({ bounds, limX: this.limX, limY: this.limY });
      scene.add(o.group); hide(o.group);
      this.obstaclePool.push(o);
    }
    this.drainPool = [];
    for (let i = 0; i < 2; i++) {
      const dr = makeDrain();
      scene.add(dr.group); hide(dr.group);
      this.drainPool.push(dr);
    }

    this.progress = this._loadProgress();

    // Fish-hunt state.
    this.fish = [];
    this.underwater = null;           // set via attachUnderwater()
    this.memory = new DisturbanceMemory(bounds);
    this.fishCaught = 0;
    this.totalFish = 0;

    this._tmp = new THREE.Vector2();
  }

  attachUnderwater(uw) { this.underwater = uw; }

  /* ---------------- progress persistence ---------------- */
  _loadProgress() {
    try {
      const p = JSON.parse(localStorage.getItem(PROGRESS_KEY));
      if (p && Array.isArray(p.stars)) return p;
    } catch (e) { /* ignore */ }
    return { stars: new Array(LEVELS.length).fill(0), unlocked: 1 };
  }
  _saveProgress() {
    try { localStorage.setItem(PROGRESS_KEY, JSON.stringify(this.progress)); } catch (e) { /* ignore */ }
  }

  /* ---------------- play-area sizing ---------------- */
  setPlayArea(limX, limY, placeScale) {
    this.limX = limX; this.limY = limY; this.placeScale = placeScale;
    const apply = (b) => b.setLimits(limX, limY);
    apply(this.player);
    this.ducklings.forEach((d) => apply(d.body));
    this.obstacles.forEach((o) => apply(o.body));
    this.extraDucks.forEach((e) => apply(e.body));
  }

  /* ---------------- level lifecycle ---------------- */
  _clearEntities() {
    // Pooled entities are hidden + reset, not destroyed (no per-level allocation).
    for (const d of this.ducklingPool) { d.group.visible = false; d.shadow.visible = false; d.body.alive = true; d.body.vel.set(0, 0); }
    for (const o of this.obstaclePool) { o.group.visible = false; o.body.vel.set(0, 0); }
    for (const dr of this.drainPool) { dr.group.visible = false; }
    // Sandbox ducks are dynamic → actually freed.
    for (const e of this.extraDucks) { this.scene.remove(e.group, e.shadow); disposeTree(e.group); disposeTree(e.shadow); }
    this.ducklings.length = 0;
    this.obstacles.length = 0;
    this.drains.length = 0;
    this.extraDucks.length = 0;
    this.goal.setActive(false);
    this._clearFish();
  }

  _clearFish() {
    for (const f of this.fish) {
      if (f.onSurface) this.scene.remove(f.mesh);
      else if (this.underwater) this.underwater.remove(f.mesh);
      f.mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
    this.fish.length = 0;
    this.fishCaught = 0;
    this.totalFish = 0;
    if (this.memory) this.memory.grid.fill(0);
  }

  /** Start the fish hunt: spawn N hidden fish; drag the duck into them to knock them up & catch. */
  startHunt(count = 4) {
    this.mode = 'hunt';
    this._clearEntities();
    this.player.setPosition(0, this.limY * 0.6);
    this.player.grabbed = false;
    this.playerVisual.group.visible = true;
    this.playerVisual.shadow.visible = true;
    for (let i = 0; i < count; i++) {
      const parts = makeFish(0.95 + Math.random() * 0.4);
      this.underwater?.add(parts.group);
      this.fish.push(new Fish(parts, { bounds: this.bounds, limX: this.limX, limY: this.limY }));
    }
    // Bank-shot balls (the one old element that earns its place): carom the flung duck off
    // them and the walls to reach fish hiding in the corners.
    [[-0.45, -0.25], [0.5, 0.35]].forEach((n, k) => {
      const o = this.obstaclePool[k];
      o.body.setLimits(this.limX, this.limY);
      o.body.setPosition(n[0] * this.placeScale, n[1] * this.placeScale);
      o.group.visible = true;
      o.flushCd = 0;            // "hot ball" timer: no sheltering here while > 0
      this.obstacles.push(o);
    });
    this.totalFish = count;
    this.fishCaught = 0;
    this.huntTime = 0;
    this.won = false;
    this.ui.showHunt(count);
  }

  _place(norm) { return [norm[0] * this.placeScale, norm[1] * this.placeScale]; }

  startLevel(i) {
    this.mode = 'play';
    this.levelIndex = Math.max(0, Math.min(LEVELS.length - 1, i));
    const L = LEVELS[this.levelIndex];
    this._clearEntities();

    const [dx, dy] = this._place(L.duck);
    this.player.setPosition(dx, dy);
    this.player.setLimits(this.limX, this.limY);
    this.playerVisual.group.visible = true;
    this.playerVisual.shadow.visible = true;

    L.ducklings.forEach((n, k) => {
      const d = this.ducklingPool[k];
      const [x, y] = this._place(n);
      d.body.alive = true; d.body.setLimits(this.limX, this.limY); d.body.setPosition(x, y);
      d.group.visible = true; d.shadow.visible = true;
      this.ducklings.push(d);
    });
    (L.obstacles || []).forEach((n, k) => {
      const o = this.obstaclePool[k];
      const [x, y] = this._place(n);
      o.body.setLimits(this.limX, this.limY); o.body.setPosition(x, y);
      o.group.visible = true;
      this.obstacles.push(o);
    });
    (L.drains || []).forEach((n, k) => {
      const dr = this.drainPool[k];
      const [x, y] = this._place(n);
      dr.setWorld(x, y);
      dr.group.visible = true;
      this.drains.push(dr);
    });
    const [gx, gy] = this._place(L.goal);
    this.goal.setWorld(gx, gy);

    this.strokes = 0;
    this.time = 0;
    this.won = false;
    this.collected = 0;
    this.totalDucklings = this.ducklings.length;

    this.ui.showHUD(this.levelIndex, L, this.totalDucklings);
    this.ui.flashTip(L.tip);
  }

  startSandbox() {
    this.mode = 'sandbox';
    this._clearEntities();
    this.player.setPosition(0, 0);
    this.playerVisual.group.visible = true;
    this.playerVisual.shadow.visible = true;
    this.won = false;
    this.ui.showSandbox();
  }

  addSandboxDuck() {
    if (this.extraDucks.length >= 8) return;
    const v = makeDuck({ scale: 0.9 + Math.random() * 0.3 });
    const body = new FloatingBody(v.group, {
      bounds: this.bounds, limX: this.limX, limY: this.limY, shadow: v.shadow,
      radius: 0.5, floatOffset: 0.2, drag: 1.3, push: 14.0, tiltAmt: 0.6,
    });
    body.setPosition((Math.random() - 0.5) * this.placeScale, (Math.random() - 0.5) * this.placeScale);
    this.scene.add(v.shadow, v.group);
    this.extraDucks.push({ body, group: v.group, shadow: v.shadow });
  }

  restart() { this.startLevel(this.levelIndex); }
  nextLevel() {
    if (this.levelIndex + 1 < LEVELS.length) this.startLevel(this.levelIndex + 1);
    else this.ui.showMenu();
  }
  toMenu() {
    this.mode = 'menu';
    this._clearEntities();
    this.playerVisual.group.visible = true;
    this.playerVisual.shadow.visible = true;
    this.player.setPosition(0, 0);
  }

  registerStroke() { if (this.mode === 'play' && !this.won) this.strokes++; }

  /**
   * Gentle "swim toward the ripple" assist — applied on each tap in PLAY mode only, so the
   * herding game is responsive. Free Play stays pure-physics gentle (the video toy feel).
   */
  onTap(uv) {
    // Every touch leaves a trace the fish remember + avoid for a few seconds.
    this.memory.add((uv.x - 0.5) * this.bounds, (uv.y - 0.5) * this.bounds, 1.0);
    if (this.mode !== 'play' || this.won) return;
    const tx = (uv.x - 0.5) * this.bounds;
    const ty = (uv.y - 0.5) * this.bounds;
    const dx = tx - this.player.pos.x;
    const dy = ty - this.player.pos.y;
    const dist = Math.hypot(dx, dy) || 1e-3;
    const strength = 0.95 * Math.max(0.12, 1 - dist / (this.bounds * 0.6));
    this.player.vel.x += (dx / dist) * strength;
    this.player.vel.y += (dy / dist) * strength;
  }

  /* ---------------- direct drag & throw ---------------- */
  /** Grab the duck if the press landed on it (world coords). Returns true if grabbed. */
  tryGrab(wx, wy) {
    const dx = wx - this.player.pos.x, dy = wy - this.player.pos.y;
    const grabR = this.player.radius * 1.4 + 0.3;
    if (Math.hypot(dx, dy) <= grabR) {
      this.player.grabbed = true;
      this.player.target.set(wx, wy);
      return true;
    }
    return false;
  }
  dragDuck(wx, wy) { if (this.player.grabbed) this.player.target.set(wx, wy); }
  releaseDuck(vx = 0, vy = 0) {
    if (!this.player.grabbed) return;
    this.player.grabbed = false;
    const flick = Math.hypot(vx, vy);
    if (flick > 1.5) {
      // CRISP throw: launch along your actual flick, not the laggy spring velocity.
      this.player.vel.set(vx, vy).multiplyScalar(1.15);
    } else {
      this.player.vel.multiplyScalar(1.2);          // soft release keeps chase momentum
    }
    const max = 23, s = this.player.vel.length();
    if (s > max) this.player.vel.multiplyScalar(max / s);
    // Spin juice ∝ throw speed; decays back to facing-motion.
    this.player.spin = (Math.random() < 0.5 ? 1 : -1) * Math.min(12, s * 0.7);
    if (this.aim) this.aim.visible = false;
  }

  /* ---------------- fish hunt ---------------- */
  _bumpFish() {
    // One strike hits ONE fish (the nearest eligible). A fish sheltering under a ball is
    // SHIELDED — only flushing (bank-shotting the ball) can dislodge it, never a bump.
    const reach = this.player.radius * 0.9 + 0.6;
    let nearest = null, nd = reach;
    for (const f of this.fish) {
      if (f.caught || f.noBump > 0 || f.shelterBall) continue;
      const d = this.player.pos.distanceTo(f.pos);
      if (d < nd) { nd = d; nearest = f; }
    }
    if (nearest) {
      const caught = nearest.bump(0.22, this.player.pos, this.player.vel.length());
      this.sim.tap(nearest.uv.x, nearest.uv.y, -0.06, 0.05);
      this.audio?.plip?.();
      if (caught) this._onFishCaught(nearest);
    }
  }

  _onFishCaught(f) {
    f.onSurface = true;
    if (this.underwater) this.underwater.remove(f.mesh);
    this.scene.add(f.mesh);                           // float ON the surface, always visible
    f.parts.bodyMat.color.set(0xf2ead8); f.parts.bodyMat.opacity = 0.97;
    f.parts.tailMat.color.set(0xf2ead8); f.parts.tailMat.opacity = 0.97;
    f.parts.shadow.visible = false;
    f.mesh.scale.set(f.size, -f.size, 1);            // belly-up
    this.fishCaught++;
    // catch juice: a bright splash burst of rings
    this.sim.tap(f.uv.x, f.uv.y, 0.16, 0.08);
    this.sim.tap(f.uv.x, f.uv.y, -0.1, 0.05);
    this.audio?.collect?.();
    this.ui.flashTip?.(`🎣 Caught ${this.fishCaught}/${this.totalFish}!`, 1400);
  }

  _floatCaught(f, dt, time) {
    f.vel.multiplyScalar(Math.exp(-1.2 * dt));
    f.pos.addScaledVector(f.vel, dt);
    const bob = Math.sin(time * 1.5 + f.pos.x) * 0.03;
    f.mesh.position.set(f.pos.x, f.pos.y, 0.07 + bob);
    f.mesh.rotation.z = f.heading;
  }

  _winHunt() {
    this.won = true;
    let best = null;
    try {
      best = JSON.parse(localStorage.getItem('ripplepond.hunt.best'));
      if (best == null || this.huntTime < best) { best = +this.huntTime.toFixed(1); localStorage.setItem('ripplepond.hunt.best', JSON.stringify(best)); }
    } catch (e) { /* ignore */ }
    for (let i = 0; i < 6; i++) this.sim.tap(0.5 + (Math.random() - 0.5) * 0.4, 0.5 + (Math.random() - 0.5) * 0.4, 0.1, 0.06);
    this.audio?.win?.();
    this.ui.showHuntWin(this.totalFish, this.huntTime, best);
  }

  /* ---------------- per-frame update ---------------- */
  update(dt, time) {
    // 1) Build the sample list (order matters for readback mapping).
    const bodies = [this.player];
    for (const d of this.ducklings) bodies.push(d.body);
    for (const o of this.obstacles) bodies.push(o.body);
    for (const e of this.extraDucks) bodies.push(e.body);
    for (const f of this.fish) if (!f.caught) bodies.push(f);

    const uvs = bodies.map((b) => b.uv);
    const samples = this.sim.sampleBodies(uvs);

    // 2) Drains pull the player (and ducklings) inward.
    if (this.mode === 'play') this._applyDrains(dt);

    // 3) Player physics.
    const preSpeed = this.player.vel.length();
    const pHit = this.player.update(dt, samples[0], time);
    if (pHit) {
      // wall splash scales with impact speed (+ a plip on a hard hit)
      this.sim.tap(pHit.x, pHit.y, -0.06 - Math.min(0.12, preSpeed * 0.012), 0.06);
      if (preSpeed > 3.5) this.audio?.plip?.();
    }

    // Moving/dragged duck disturbs the water along its path (a wake).
    const sp = this.player.vel.length();
    if (sp > 1.2 && time - this._lastWake > 0.045) {
      const uv = this.player.uv;
      this.sim.inject(uv.x, uv.y, -0.018 - Math.min(0.05, sp * 0.004), 0.05);
      this.memory.add(this.player.pos.x, this.player.pos.y, 0.6);
      this._lastWake = time;
    }

    // Aim guide: a streak from the duck along the drag direction (= your throw vector).
    if (this.aim) {
      if (this.player.grabbed && sp > 0.6) {
        const ang = Math.atan2(this.player.vel.y, this.player.vel.x);
        const len = Math.min(5.0, sp * 0.3);
        const pw = Math.min(1, sp / 18);                 // throw power 0..1
        this.aim.visible = true;
        this.aim.position.set(this.player.pos.x, this.player.pos.y, 0.09);
        this.aim.rotation.z = ang;
        this.aim.scale.set(len, 0.9 + pw * 0.6, 1);      // fatter streak = harder throw
        this.aim.material.color.setHSL(0.55 - pw * 0.42, 0.85, 0.62); // cyan→warm with power
        this.aim.material.opacity = Math.min(0.6, 0.14 + sp * 0.05);
      } else {
        this.aim.visible = false;
      }
    }

    // 4) Ducklings / obstacles / extra ducks physics.
    let si = 1;
    for (const d of this.ducklings) { d.body.update(dt, samples[si++], time); }
    for (const o of this.obstacles) { o.body.update(dt, samples[si++], time); }
    for (const e of this.extraDucks) { e.body.update(dt, samples[si++], time); }

    // Fish: sense disturbance, swim / flee / dive; caught ones float belly-up on the surface.
    if (this.mode === 'hunt') {
      this.memory.decay(dt);
      for (const o of this.obstacles) o.flushCd = Math.max(0, (o.flushCd || 0) - dt);
      // Fish won't shelter under a "hot" (recently bank-shot) ball.
      const balls = this.obstacles.filter((o) => (o.flushCd || 0) <= 0).map((o) => o.body.pos);
      for (const f of this.fish) {
        if (f.caught) { this._floatCaught(f, dt, time); continue; }
        const s = samples[si++];
        const disturb = Math.abs(s.height) * 1.2 + Math.hypot(s.nx, s.ny) * 0.35;
        f.update(dt, disturb, this.memory, time, this.player.pos, this.player.vel, balls, this.fish);
      }
      this._bumpFish();
      if (!this.won) { this.huntTime += dt; this.ui.updateHuntHUD(this.fishCaught, this.totalFish, this.huntTime); }
      if (!this.won && this.totalFish > 0 && this.fishCaught >= this.totalFish) this._winHunt();
    }

    // 5) Obstacle collisions push the player out (+ ripple).
    if (this.mode === 'play' || this.mode === 'hunt') this._resolveObstacles();

    // 6) Collect ducklings + goal/win (play mode only).
    if (this.mode === 'play' && !this.won) this._collectAndWin(dt);

    // 7) Visual updates.
    for (const dr of this.drains) dr.update(time);
    this.goal.update(time);

    // 8) Timer + HUD.
    if (this.mode === 'play' && !this.won) {
      this.time += dt;
      this.ui.updateHUD({
        level: this.levelIndex,
        ducklings: `${this.collected}/${this.totalDucklings}`,
        strokes: this.strokes,
        time: this.time,
      });
    }
  }

  _applyDrains(dt) {
    const affect = (body) => {
      for (const dr of this.drains) {
        this._tmp.set(dr.pos.x - body.pos.x, dr.pos.y - body.pos.y);
        const dist = this._tmp.length();
        if (dist < dr.range && dist > 1e-3) {
          const falloff = 1 - dist / dr.range;
          const f = dr.pull * falloff * falloff * dt;
          body.vel.x += (this._tmp.x / dist) * f;
          body.vel.y += (this._tmp.y / dist) * f;
        }
      }
    };
    affect(this.player);
    for (const d of this.ducklings) affect(d.body);

    // Player sucked in → soft reset to a safe nearby spot.
    for (const dr of this.drains) {
      if (this.player.pos.distanceTo(dr.pos) < dr.deadly) {
        const [dx, dy] = this._place(LEVELS[this.levelIndex].duck);
        this.player.setPosition(dx, dy);
        this.sim.inject(this.player.uv.x, this.player.uv.y, 0.1, 0.08);
        this.ui.flashTip('Sucked in! Try again.');
        this.audio?.plip();
      }
    }
  }

  _resolveObstacles() {
    for (const o of this.obstacles) {
      this._tmp.set(this.player.pos.x - o.body.pos.x, this.player.pos.y - o.body.pos.y);
      const dist = this._tmp.length();
      const minD = this.player.radius + o.radius;
      if (dist < minD && dist > 1e-4) {
        const nx = this._tmp.x / dist, ny = this._tmp.y / dist;
        const push = (minD - dist);
        this.player.pos.x += nx * push;
        this.player.pos.y += ny * push;
        // Reflect velocity along the contact normal.
        const vn = this.player.vel.x * nx + this.player.vel.y * ny;
        if (vn < 0) { this.player.vel.x -= 1.7 * vn * nx; this.player.vel.y -= 1.7 * vn * ny; }
        // Nudge the ball, spin the duck a little, and splash on a hard carom.
        o.body.vel.x -= nx * 0.5; o.body.vel.y -= ny * 0.5;
        const impact = Math.abs(vn);
        this.sim.tap(this.player.uv.x, this.player.uv.y, -0.04 - Math.min(0.1, impact * 0.012), 0.05);
        if (impact > 3) {
          this.player.spin += (Math.random() < 0.5 ? 1 : -1) * impact * 0.4;
          this.audio?.plip?.();
          // A hard bank shot: the ball takes the hit (no damage to the fish), flushes any
          // fish hiding under it, and marks that spot "discovered" for 5s (no re-hiding there).
          o.flushCd = 5;
          for (const f of this.fish) { if (f.shelterBall && f.pos.distanceTo(o.body.pos) < 2.2) f.flush(); }
        }
      }
    }
  }

  _collectAndWin(dt) {
    for (const d of this.ducklings) {
      if (!d.body.alive) continue;
      const dist = this.player.pos.distanceTo(d.body.pos);
      if (dist < this.player.radius + d.body.radius + 0.25) {
        d.body.alive = false;
        d.group.visible = false; d.shadow.visible = false;   // pooled: hide, don't destroy
        this.collected++;
        this.sim.inject(d.body.uv.x, d.body.uv.y, 0.12, 0.06);
        this.audio?.collect();
        this.ui.updateHUD({
          level: this.levelIndex,
          ducklings: `${this.collected}/${this.totalDucklings}`,
          strokes: this.strokes, time: this.time,
        });
        if (this.collected >= this.totalDucklings) {
          this.goal.setActive(true);
          this.ui.flashTip('All gathered! Reach the glowing ring.');
        }
      }
    }
    if (this.goal.active && this.player.pos.distanceTo(this.goal.pos) < this.goal.radius) {
      this._win();
    }
  }

  _win() {
    this.won = true;
    const L = LEVELS[this.levelIndex];
    let stars = 1;
    if (this.strokes <= L.parStrokes && this.time <= L.parTime) stars = 3;
    else if (this.strokes <= L.parStrokes * 1.6 && this.time <= L.parTime * 1.6) stars = 2;

    this.progress.stars[this.levelIndex] = Math.max(this.progress.stars[this.levelIndex] || 0, stars);
    this.progress.unlocked = Math.max(this.progress.unlocked, Math.min(LEVELS.length, this.levelIndex + 2));
    this._saveProgress();

    // Celebration ripples.
    for (let i = 0; i < 5; i++) {
      this.sim.inject(0.5 + (Math.random() - 0.5) * 0.4, 0.5 + (Math.random() - 0.5) * 0.4, 0.1, 0.06);
    }
    this.audio?.win();
    this.ui.showWin({
      levelIndex: this.levelIndex, stars,
      strokes: this.strokes, time: this.time, par: L,
      isLast: this.levelIndex + 1 >= LEVELS.length,
    });
  }
}
