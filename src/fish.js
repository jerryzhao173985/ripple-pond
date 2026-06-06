import * as THREE from 'three';

/**
 * Fish — fast, shy, clever prey that swim at varying depth.
 *
 * Sensing (the heart of the difficulty):
 *   • surface disturbance near them (the wave field) → fear
 *   • the DUCK itself nearby → fear + flee directly away from it
 *   • recently-touched water (a decaying memory map) → avoid
 * When the duck gets close they JUKE — a sharp sideways break — so a duck that just tracks
 * their position overshoots. You can't pin them; you must out-think them with throws & corners.
 *
 * Depth: a bump from the duck knocks a fish shallower and it SINKS BACK SLOWLY, so repeated
 * hits accumulate it toward the surface. Catch it while shallow → it rolls belly-up and floats.
 *
 * Rendering: a small group (soft floor shadow + body + wiggling tail) in the underwater layer,
 * so it's only revealed where the surface is disturbed.
 */

/* ---------- textures ---------- */
let _body = null, _tail = null, _shadow = null;
function bodyTexture() {
  if (_body) return _body;
  const c = document.createElement('canvas'); c.width = 128; c.height = 80;
  const g = c.getContext('2d');
  g.fillStyle = '#e6edf2';                  // light → tinted by material.color
  g.beginPath(); g.ellipse(66, 40, 42, 20, 0, 0, Math.PI * 2); g.fill();   // body
  g.beginPath(); g.moveTo(70, 20); g.quadraticCurveTo(86, 4, 100, 20); g.closePath(); g.fill(); // dorsal fin
  g.beginPath(); g.moveTo(66, 60); g.quadraticCurveTo(78, 74, 92, 60); g.closePath(); g.fill(); // belly fin
  g.fillStyle = '#13222b'; g.beginPath(); g.arc(100, 34, 3.6, 0, Math.PI * 2); g.fill();        // eye
  _body = new THREE.CanvasTexture(c); _body.colorSpace = THREE.SRGBColorSpace; return _body;
}
function tailTexture() {
  if (_tail) return _tail;
  const c = document.createElement('canvas'); c.width = 64; c.height = 80;
  const g = c.getContext('2d');
  g.fillStyle = '#e6edf2';
  g.beginPath(); g.moveTo(60, 40); g.lineTo(8, 12); g.lineTo(22, 40); g.lineTo(8, 68); g.closePath(); g.fill();
  _tail = new THREE.CanvasTexture(c); _tail.colorSpace = THREE.SRGBColorSpace; return _tail;
}
function shadowTexture() {
  if (_shadow) return _shadow;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(2,22,36,0.85)'); grad.addColorStop(1, 'rgba(2,22,36,0)');
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  _shadow = new THREE.CanvasTexture(c); _shadow.colorSpace = THREE.SRGBColorSpace; return _shadow;
}

/** Build a fish group: floor shadow + body + a tail that pivots (wiggle). +X is forward. */
export function makeFish(scale = 1) {
  const group = new THREE.Group();

  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.5 });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.0 * scale, 1.2 * scale), shadowMat);
  shadow.position.set(-0.15 * scale, 0, -0.02);
  group.add(shadow);

  const bodyMat = new THREE.MeshBasicMaterial({ map: bodyTexture(), transparent: true, depthWrite: false, color: 0x16323f });
  const body = new THREE.Mesh(new THREE.PlaneGeometry(1.35 * scale, 0.85 * scale), bodyMat);
  group.add(body);

  const tailMat = new THREE.MeshBasicMaterial({ map: tailTexture(), transparent: true, depthWrite: false, color: 0x16323f });
  const tailPivot = new THREE.Group();
  tailPivot.position.set(-0.55 * scale, 0, 0);
  const tail = new THREE.Mesh(new THREE.PlaneGeometry(0.55 * scale, 0.7 * scale), tailMat);
  tail.position.set(-0.18 * scale, 0, 0);
  tailPivot.add(tail);
  group.add(tailPivot);

  return { group, shadow, shadowMat, bodyMat, tailMat, tailPivot };
}

/* ---------- disturbance memory ---------- */
export class DisturbanceMemory {
  constructor(bounds, n = 14) { this.bounds = bounds; this.n = n; this.grid = new Float32Array(n * n); }
  _idx(x, y) {
    const u = Math.floor((x / this.bounds + 0.5) * this.n);
    const v = Math.floor((y / this.bounds + 0.5) * this.n);
    return [Math.max(0, Math.min(this.n - 1, u)), Math.max(0, Math.min(this.n - 1, v))];
  }
  add(wx, wy, amt = 1) { const [u, v] = this._idx(wx, wy); this.grid[v * this.n + u] = Math.min(2, this.grid[v * this.n + u] + amt); }
  at(wx, wy) { const [u, v] = this._idx(wx, wy); return this.grid[v * this.n + u]; }
  decay(dt) { const k = Math.exp(-dt / 3.0); for (let i = 0; i < this.grid.length; i++) this.grid[i] *= k; }
  safeDir(wx, wy, out) {
    const s = this.bounds / this.n;
    out.set(-(this.at(wx + s, wy) - this.at(wx - s, wy)), -(this.at(wx, wy + s) - this.at(wx, wy - s)));
    return out;
  }
}

/* ---------- fish agent ---------- */
export class Fish {
  constructor(parts, { bounds, limX, limY }) {
    this.parts = parts;
    this.mesh = parts.group;
    this.bounds = bounds;
    this.limX = limX ?? bounds * 0.5;
    this.limY = limY ?? bounds * 0.5;

    this.pos = new THREE.Vector2((Math.random() - 0.5) * bounds * 0.45, (Math.random() - 0.5) * bounds * 0.45);
    this.vel = new THREE.Vector2();
    this.heading = Math.random() * Math.PI * 2;
    this.depth = 0.82 + Math.random() * 0.13;   // start genuinely deep (spotted gradually)
    this.targetDepth = this.depth;
    this.fear = 0;
    this.stun = 0;
    this.jukeCd = 0;
    this.escape = 0;     // guaranteed escape-dart timer after a bump (anti-pin)
    this.noBump = 0;     // can't be re-bumped until it has darted away
    this.panic = 0;      // builds when cornered with nowhere calm to flee
    this.shelterBall = null; // ball it's hiding under (occluded from above)
    this.caught = false;
    this.onSurface = false;
    this.wander = 0;
    this.size = 1.0 + Math.random() * 0.45;
    this.swim = Math.random() * 6.28;
    this._safe = new THREE.Vector2();
    this._away = new THREE.Vector2();
    this._toBall = new THREE.Vector2();
    this.mesh.scale.setScalar(this.size);
  }

  setLimits(limX, limY) { this.limX = limX; this.limY = limY; }
  get uv() { return { x: this.pos.x / this.bounds + 0.5, y: this.pos.y / this.bounds + 0.5 }; }

  update(dt, disturb, mem, time, duckPos, duckVel, balls, school) {
    if (this.caught) return; // game handles floating

    // --- sense threats ---
    const memHere = mem.at(this.pos.x, this.pos.y);
    let duckDist = 1e9, duckClosing = 0;
    if (duckPos) {
      this._away.set(this.pos.x - duckPos.x, this.pos.y - duckPos.y);
      duckDist = this._away.length() || 1e-3;
      // closing speed of the duck toward the fish
      if (duckVel) duckClosing = -((duckVel.x * this._away.x + duckVel.y * this._away.y) / duckDist);
    }
    const duckThreat = Math.max(0, 1 - duckDist / 4.5);            // within ~4.5 units
    const sensed = disturb * 5.0 + memHere * 0.5 + duckThreat * 1.3;
    this.fear = Math.max(this.fear * Math.exp(-dt / 1.7), Math.min(1.5, sensed));
    this.jukeCd = Math.max(0, this.jukeCd - dt);
    this.escape = Math.max(0, this.escape - dt);
    this.noBump = Math.max(0, this.noBump - dt);

    // --- panic / shelter: if you've rippled EVERYWHERE (nowhere calm to flee), a cornered
    // fish bolts under the nearest ball, where it's occluded from above. Bank-shot the ball to flush it. ---
    mem.safeDir(this.pos.x, this.pos.y, this._safe);
    const safeMag = this._safe.length();
    const cornered = this.fear > 0.7 && (memHere > 0.5 || safeMag < 0.12);
    this.panic = cornered ? Math.min(2, this.panic + dt) : Math.max(0, this.panic - dt * 0.8);
    if (!this.shelterBall && this.panic > 1.0 && balls && balls.length) {
      let bb = null, bd = 1e9;
      for (const b of balls) { const d = (b.x - this.pos.x) ** 2 + (b.y - this.pos.y) ** 2; if (d < bd) { bd = d; bb = b; } }
      this.shelterBall = bb;
    }
    if (this.shelterBall && this.fear < 0.25) { this.shelterBall = null; this.panic = 0; }

    // --- decide heading + speed ---
    this.wander -= dt;
    if (this.wander <= 0) { this.heading += (Math.random() - 0.5) * 1.4; this.wander = 0.3 + Math.random() * 0.8; }

    let speed;
    if (this.escape > 0) {
      // Guaranteed escape-dart after a bump → you CANNOT pin a fish.
      speed = 7.5 * this.size;
      this.targetDepth = this.depth;
    } else if (this.shelterBall) {
      // Bolt under the nearest ball and hover there (the ball hides it from above).
      this._toBall.set(this.shelterBall.x - this.pos.x, this.shelterBall.y - this.pos.y);
      const dB = this._toBall.length();
      const ang = Math.atan2(this._toBall.y, this._toBall.x);
      const d = Math.atan2(Math.sin(ang - this.heading), Math.cos(ang - this.heading));
      this.heading += d * Math.min(1, dt * 6);
      speed = (dB > 0.45 ? 4.0 : 0.25) * this.size;                 // rush in, then hide still
      this.targetDepth = this.depth;
    } else if (this.fear > 0.3) {
      // Agitated near the surface — too spooked to settle, so it HOLDS its depth (won't dive).
      // That's why bumps accumulate: keep it scared and it can't rest-dive your progress away.
      let ax = this._away.x, ay = this._away.y;
      if (duckDist > 6) { ax = this._safe.x; ay = this._safe.y; }
      let fleeAng = (ax || ay) ? Math.atan2(ay, ax) : this.heading + Math.PI;
      if (duckDist < 2.6 && duckClosing > 0.3 && this.jukeCd <= 0) {
        const side = Math.random() < 0.5 ? 1 : -1;
        fleeAng += side * (Math.PI * 0.5 + Math.random() * 0.5);
        this.jukeCd = 0.32 + Math.random() * 0.3;
        speed = (6.2 + this.fear * 1.5) * this.size;     // sharper, faster break
      } else {
        speed = (3.4 + this.fear * 2.0) * this.size;
      }
      const d = Math.atan2(Math.sin(fleeAng - this.heading), Math.cos(fleeAng - this.heading));
      this.heading += d * Math.min(1, dt * 7);
      this.targetDepth = this.depth;                                // HOLD — agitated, won't dive
    } else {
      // Calm → it RESTS and recovers by sinking deep (undoing your progress). Keep the pressure on!
      this.targetDepth += (0.92 - this.targetDepth) * Math.min(1, dt * 0.5);
      speed = 1.0 * this.size;
    }

    // --- separation: fish never stack (so one strike can't hit a cluster) ---
    if (school && !this.shelterBall) {
      let sx = 0, sy = 0, cnt = 0;
      for (const other of school) {
        if (other === this || other.caught) continue;
        const dx = this.pos.x - other.pos.x, dy = this.pos.y - other.pos.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 6.25 && d2 > 1e-4) { const inv = 1 / Math.sqrt(d2); sx += dx * inv; sy += dy * inv; cnt++; }
      }
      if (cnt) {
        const sepAng = Math.atan2(sy, sx);
        const d = Math.atan2(Math.sin(sepAng - this.heading), Math.cos(sepAng - this.heading));
        this.heading += d * Math.min(0.6, dt * 3.0);
      }
    }

    // --- integrate ---
    this.vel.set(Math.cos(this.heading) * speed, Math.sin(this.heading) * speed);
    this.pos.addScaledVector(this.vel, dt);
    this.depth += (this.targetDepth - this.depth) * Math.min(1, dt * 0.5);

    const lx = this.limX - 0.4, ly = this.limY - 0.4;
    if (this.pos.x > lx || this.pos.x < -lx) { this.pos.x = Math.max(-lx, Math.min(lx, this.pos.x)); this.heading = Math.PI - this.heading; }
    if (this.pos.y > ly || this.pos.y < -ly) { this.pos.y = Math.max(-ly, Math.min(ly, this.pos.y)); this.heading = -this.heading; }

    // --- animate (tail wiggle + bank) ---
    this.swim += dt * (3 + speed * 1.5);
    this.parts.tailPivot.rotation.z = Math.sin(this.swim) * (0.3 + Math.min(0.5, speed * 0.05));
    this._place();
  }

  /**
   * Duck knock: rise (scaled by IMPACT SPEED — a hard thrown duck slams it way up, a gentle
   * drag barely nudges), dart away, spike fear, knock it out of any shelter. Returns true if caught.
   */
  bump(catchDepth = 0.22, duckPos = null, impactSpeed = 4) {
    // Lift scales with impact (hard throw >> gentle drag) but is CAPPED so even a hard hit
    // from rest-depth can never one-shot a fish — it always takes several hits to land it.
    const rise = Math.max(0.1, Math.min(0.3, 0.07 + impactSpeed * 0.012));
    this.depth = Math.max(-0.02, this.depth - rise);
    this.targetDepth = this.depth;
    this.fear = 1.5;
    this.shelterBall = null; this.panic = 0;
    if (duckPos) this.heading = Math.atan2(this.pos.y - duckPos.y, this.pos.x - duckPos.x); // flee vector
    this.escape = 0.5;                // guaranteed dart away → can't be pinned
    this.noBump = 0.5;                // ...and can't be re-hit until it has fled
    if (this.depth <= catchDepth) { this.caught = true; return true; }
    return false;
  }

  /** Bank-shotting the ball it hides under flushes it into the open (no damage — the ball took
   *  the hit). It bolts away agitated; the ball is then "discovered" (game keeps it off-limits). */
  flush() {
    this.shelterBall = null; this.panic = 0;
    this.fear = 1.5; this.escape = 0.7;
    this.heading += Math.PI + (Math.random() - 0.5);
  }

  _place() {
    const z = -0.18 - this.depth * 0.55;
    this.mesh.position.set(this.pos.x, this.pos.y, z);
    this.mesh.rotation.z = this.heading;
    const fade = 1 - this.depth;
    // Deeper → much fainter + bluer (a vague "guess"); clear only when driven shallow.
    const col = new THREE.Color(0x16323f).lerp(new THREE.Color(0x0e3a52), this.depth * 0.7);
    const op = 0.22 + fade * fade * 0.6;     // fades off fast with depth
    this.parts.bodyMat.color.copy(col); this.parts.bodyMat.opacity = op;
    this.parts.tailMat.color.copy(col); this.parts.tailMat.opacity = op;
    this.parts.shadow.position.z = -0.02 - this.depth * 0.02;
    this.parts.shadow.scale.setScalar(1 + this.depth * 0.6);
    this.parts.shadowMat.opacity = 0.18 + this.depth * 0.28;       // deeper → bigger, softer floor shadow
  }
}
