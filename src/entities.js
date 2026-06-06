import * as THREE from 'three';
import { FloatingBody, makeDuck } from './duck.js';

/**
 * Game entities, all riding the same water surface:
 *   • Duckling  — small floating collectible (a tiny duck)
 *   • GoalRing  — glowing home ring; activates once all ducklings are gathered
 *   • Drain     — hazard that pulls the duck inward
 *   • Obstacle  — floating beach ball the duck bounces off
 */

export function makeDuckling({ bounds, limX, limY }) {
  const { group, shadow } = makeDuck({ scale: 0.62, bodyColor: 0xffe04d });
  const body = new FloatingBody(group, {
    bounds, limX, limY, shadow,
    radius: 0.42,
    floatOffset: 0.18,
    drag: 2.0, push: 2.0, tiltAmt: 0.6, bobAmp: 0.06, bobRate: 2.3,
  });
  return { body, group, shadow, kind: 'duckling' };
}

export function makeGoalRing() {
  const grp = new THREE.Group();

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.78, 0.12, 18, 48),
    new THREE.MeshStandardMaterial({
      color: 0x7be0ff, emissive: 0x2bd0ff, emissiveIntensity: 1.3,
      roughness: 0.3, metalness: 0.1,
    })
  );
  grp.add(ring);

  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.74, 40),
    new THREE.MeshBasicMaterial({ color: 0x9af0ff, transparent: true, opacity: 0.18, depthWrite: false })
  );
  disc.position.z = -0.02;
  grp.add(disc);

  grp.position.z = 0.16;
  grp.visible = false;

  return {
    group: grp,
    radius: 0.9,
    pos: new THREE.Vector2(0, 0),
    active: false,
    setActive(v) { this.active = v; grp.visible = v; },
    setWorld(x, y) { this.pos.set(x, y); grp.position.x = x; grp.position.y = y; },
    update(t) {
      const s = 1 + Math.sin(t * 2.2) * 0.06;
      ring.scale.setScalar(s);
      disc.material.opacity = 0.14 + Math.sin(t * 2.2) * 0.06;
      grp.rotation.z = t * 0.5;
    },
  };
}

export function makeDrain() {
  const grp = new THREE.Group();

  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.7, 0.1, 14, 40),
    new THREE.MeshStandardMaterial({ color: 0x0a3550, roughness: 0.7 })
  );
  grp.add(rim);

  const hole = new THREE.Mesh(
    new THREE.CircleGeometry(0.66, 36),
    new THREE.MeshBasicMaterial({ color: 0x041726, transparent: true, opacity: 0.85, depthWrite: false })
  );
  hole.position.z = -0.03;
  grp.add(hole);

  // Swirl arms.
  const swirl = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const arm = new THREE.Mesh(
      new THREE.RingGeometry(0.2 + i * 0.14, 0.27 + i * 0.14, 28, 1, 0, Math.PI * 1.15),
      new THREE.MeshBasicMaterial({ color: 0x6fc3f0, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
    );
    arm.rotation.z = (i / 3) * Math.PI * 2;
    swirl.add(arm);
  }
  grp.add(swirl);
  grp.position.z = 0.05;
  grp.scale.setScalar(1.45);          // bigger, clearer whirlpool

  return {
    group: grp,
    pos: new THREE.Vector2(0, 0),
    range: 3.4,                       // wider influence
    pull: 12.0,                       // stronger suction (feels like a hazard)
    deadly: 0.75,
    setWorld(x, y) { this.pos.set(x, y); grp.position.x = x; grp.position.y = y; },
    update(t) { swirl.rotation.z = -t * 3.2; },   // faster spin reads as suction
  };
}

export function makeObstacle({ bounds, limX, limY }) {
  // A striped beach ball — visually bobs, acts as a static-ish collider.
  const tex = beachBallTexture();
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.55, 28, 20),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.4, metalness: 0.0 })
  );
  const grp = new THREE.Group();
  grp.add(ball);

  const body = new FloatingBody(grp, {
    bounds, limX, limY,
    radius: 0.6,
    floatOffset: 0.3,
    drag: 4.5, push: 0.25, tiltAmt: 0.3, bobAmp: 0.06, bobRate: 1.5,
  });
  return { body, group: grp, kind: 'obstacle', radius: 0.62 };
}

let _ballTex = null;
function beachBallTexture() {
  if (_ballTex) return _ballTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  const colors = ['#ff5a5a', '#ffd23f', '#3fb6ff', '#7bd66a', '#ff8fd0', '#ffffff'];
  const n = colors.length;
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i];
    g.fillRect((i / n) * 256, 0, 256 / n + 1, 128);
  }
  _ballTex = new THREE.CanvasTexture(c);
  _ballTex.colorSpace = THREE.SRGBColorSpace;
  return _ballTex;
}
