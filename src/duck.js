import * as THREE from 'three';

/**
 * FloatingBody — a body riding the water height field.
 *   • vertical:   y = sampledWaterHeight + floatOffset + gentle bob      (buoyancy)
 *   • horizontal: acceleration ∝ surface tilt (sample.nx, sample.ny)      (wave push)
 *   • orientation: local up aligned to the surface normal + slow yaw
 *   • walls: reflect off the per-axis play-bounds (returns a ripple hit)
 *   • shadow: an optional flat contact-shadow that tracks the body on the water plane
 *
 * Position is kept in pool-plane coords (x,y); +z is height out of the water.
 */
export class FloatingBody {
  constructor(mesh, {
    bounds,
    limX = null,
    limY = null,
    radius = 0.5,
    floatOffset = 0.0,
    drag = 1.6,
    push = 1.0,
    tiltAmt = 0.5,
    bobAmp = 0.04,
    bobRate = 1.7,
    shadow = null,
  } = {}) {
    this.mesh = mesh;
    this.shadow = shadow;
    this.bounds = bounds;
    this.limX = limX ?? bounds * 0.5;
    this.limY = limY ?? bounds * 0.5;
    this.radius = radius;
    this.floatOffset = floatOffset;
    this.drag = drag;
    this.push = push;
    this.tiltAmt = tiltAmt;
    this.bobAmp = bobAmp;
    this.bobRate = bobRate;

    this.pos = new THREE.Vector2(0, 0);
    this.vel = new THREE.Vector2(0, 0);
    this.yaw = Math.random() * Math.PI * 2;
    this.yawRate = (Math.random() - 0.5) * 0.16;
    this.phase = Math.random() * Math.PI * 2;
    this.alive = true;

    // Direct-drag (grab & throw) state.
    this.grabbed = false;
    this.target = new THREE.Vector2();   // pointer position while grabbed
    this.grabK = 42;                      // spring stiffness toward the pointer
    this.grabDrag = 8;                    // damping while held (responsive but laggy)
    this.restitution = 0.6;               // wall bounciness
    this.spin = 0;                        // throw spin (decays back to facing-motion)

    this._up = new THREE.Vector3(0, 0, 1);
    this._n = new THREE.Vector3();
    this._qTilt = new THREE.Quaternion();
    this._qYaw = new THREE.Quaternion();
  }

  setPosition(x, y) {
    this.pos.set(x, y); this.vel.set(0, 0);
    this.mesh.position.set(x, y, this.floatOffset);
    if (this.shadow) this.shadow.position.set(x, y, 0.045);
  }

  setLimits(limX, limY) { this.limX = limX; this.limY = limY; }

  get uv() {
    return { x: this.pos.x / this.bounds + 0.5, y: this.pos.y / this.bounds + 0.5 };
  }

  update(dt, sample, time) {
    if (this.grabbed) {
      // Chase the pointer with inertia (spring + heavy damping) → laggy, floaty feel.
      this.vel.x += (this.target.x - this.pos.x) * this.grabK * dt;
      this.vel.y += (this.target.y - this.pos.y) * this.grabK * dt;
      this.vel.multiplyScalar(Math.exp(-this.grabDrag * dt));
    } else {
      // Coast: ripples nudge the float; LOW drag so a throw glides far and skids.
      this.vel.x += sample.nx * this.push * dt;
      this.vel.y += sample.ny * this.push * dt;
      this.vel.multiplyScalar(Math.exp(-this.drag * dt));
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Reflect off the per-axis pool walls (= visible screen edges).
    let hit = null;
    const limX = this.limX - this.radius;
    const limY = this.limY - this.radius;
    const REST = this.restitution;
    if (this.pos.x > limX) { this.pos.x = limX; this.vel.x = -Math.abs(this.vel.x) * REST; hit = this.uv; }
    else if (this.pos.x < -limX) { this.pos.x = -limX; this.vel.x = Math.abs(this.vel.x) * REST; hit = this.uv; }
    if (this.pos.y > limY) { this.pos.y = limY; this.vel.y = -Math.abs(this.vel.y) * REST; hit = this.uv; }
    else if (this.pos.y < -limY) { this.pos.y = -limY; this.vel.y = Math.abs(this.vel.y) * REST; hit = this.uv; }

    const bob = Math.sin(time * this.bobRate + this.phase) * this.bobAmp;
    this.mesh.position.set(this.pos.x, this.pos.y, sample.height + this.floatOffset + bob);
    if (this.shadow) this.shadow.position.set(this.pos.x, this.pos.y, 0.045);

    // Spin from a hard throw overrides steering, then decays back to facing-motion.
    if (Math.abs(this.spin) > 0.15) {
      this.yaw += this.spin * dt;
      this.spin *= Math.exp(-2.2 * dt);
    } else {
      const speed = this.vel.length();
      if (speed > 0.15) {
        const target = Math.atan2(this.vel.y, this.vel.x);
        let d = target - this.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw += d * Math.min(1, dt * 2.0);
      } else {
        this.yaw += this.yawRate * dt;
      }
    }

    this._n.set(sample.nx * this.tiltAmt, sample.ny * this.tiltAmt, 1).normalize();
    this._qTilt.setFromUnitVectors(this._up, this._n);
    this._qYaw.setFromAxisAngle(this._up, this.yaw);
    this.mesh.quaternion.copy(this._qTilt).multiply(this._qYaw);

    return hit;
  }
}

/* ---------------- Procedural rubber duck ---------------- */

let _shadowTex = null;
function shadowTexture() {
  if (_shadowTex) return _shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, 'rgba(3, 30, 52, 0.42)');
  grad.addColorStop(0.55, 'rgba(3, 30, 52, 0.20)');
  grad.addColorStop(1, 'rgba(3, 30, 52, 0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  _shadowTex = new THREE.CanvasTexture(c);
  _shadowTex.colorSpace = THREE.SRGBColorSpace;
  return _shadowTex;
}

/**
 * A cute cartoon rubber duck. Local frame: +Z up, +X forward (beak direction).
 * Tuned to read clearly from a PURE top-down camera: round body + a distinct head circle
 * ahead of it, two eyes, and an orange beak poking forward.
 * Returns { group, shadow } — add BOTH to the scene; the FloatingBody tracks the shadow.
 */
export function makeDuck({ scale = 1, bodyColor = 0xffd21a, beakColor = 0xff8a1e } = {}) {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshStandardMaterial({
    color: bodyColor, roughness: 0.38, metalness: 0.0,
    emissive: new THREE.Color(bodyColor).multiplyScalar(0.22),
  });
  const beakMat = new THREE.MeshStandardMaterial({
    color: beakColor, roughness: 0.35,
    emissive: new THREE.Color(beakColor).multiplyScalar(0.18),
  });
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1410, roughness: 0.25 });
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, emissive: 0x222222 });

  // Body — the plump bulk: a big rounded sphere, the widest part of the silhouette.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.64, 36, 28), bodyMat);
  body.scale.set(1.12, 1.0, 0.82);
  body.position.set(-0.05, 0, 0);
  group.add(body);

  // Waterline foam ring — a subtle bright meniscus where the duck meets the water.
  const foam = new THREE.Mesh(
    new THREE.RingGeometry(0.66, 0.74, 44),
    new THREE.MeshBasicMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })
  );
  foam.position.set(-0.05, 0, -0.09);
  group.add(foam);

  // Tail — small rounded upturned nub at the back (−X). Cute, not a spike.
  const tail = new THREE.Mesh(new THREE.SphereGeometry(0.18, 18, 14), bodyMat);
  tail.position.set(-0.64, 0, 0.34);
  tail.scale.set(0.95, 0.85, 1.2);
  group.add(tail);

  // Head — a smaller rounded bump sitting ON the front of the body (not beside it).
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 32, 24), bodyMat);
  head.position.set(0.4, 0, 0.62);
  group.add(head);

  // Cheeks — slightly widen the head so it reads round from above.
  head.scale.set(1.0, 1.05, 0.98);

  // Beak — a wide flat orange bill poking forward, angled slightly down.
  const bill = new THREE.Mesh(new THREE.SphereGeometry(0.2, 24, 18), beakMat);
  bill.position.set(0.78, 0, 0.56);
  bill.scale.set(1.4, 1.7, 0.42);
  bill.rotation.y = -0.1;
  group.add(bill);

  // Eyes — black dot + white highlight, high on the head so they read from straight above.
  const eyeGeo = new THREE.SphereGeometry(0.07, 16, 14);
  const hlGeo = new THREE.SphereGeometry(0.028, 10, 8);
  for (const s of [-1, 1]) {
    const eye = new THREE.Mesh(eyeGeo, eyeMat);
    eye.position.set(0.46, s * 0.21, 0.92);
    group.add(eye);
    const hl = new THREE.Mesh(hlGeo, whiteMat);
    hl.position.set(0.49, s * 0.195, 0.96);
    group.add(hl);
  }

  group.scale.setScalar(scale);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  // Soft contact shadow (flat quad on the water; tracked by FloatingBody).
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(1.9 * scale, 1.5 * scale),
    new THREE.MeshBasicMaterial({
      map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.9,
    })
  );
  shadow.position.z = 0.045;
  shadow.renderOrder = -1;

  return { group, shadow };
}
