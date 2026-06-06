import * as THREE from 'three';

/**
 * Procedural swimming-pool tile floor → THREE.CanvasTexture.
 *
 * Look targets (from the reference video):
 *   - saturated cyan-blue ceramic tiles
 *   - lighter grout grid lines between tiles
 *   - subtle per-tile brightness/hue variation + faint mottling so it reads as ceramic
 *
 * The water shader (water.js) samples this with a refraction UV offset, so the grid
 * appears to ripple. We bake the whole floor into ONE canvas (no repeat) and clamp at
 * the edges so the small refraction offset never wraps.
 */

// Tiny deterministic PRNG (mulberry32) so the floor looks identical every load.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeTileTexture(renderer, {
  size = 2048,
  tilesAcross = 18,
  seed = 1337,
} = {}) {
  const rng = mulberry32(seed);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');

  // Base wash (so grout-gap pixels are never pure black)
  const base = ctx.createLinearGradient(0, 0, size, size);
  base.addColorStop(0, '#39bdf0');
  base.addColorStop(1, '#1f9fdd');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);

  const cell = size / tilesAcross;
  const grout = Math.max(2, Math.round(cell * 0.045)); // grout line thickness

  // Draw each tile as a rounded-ish square with its own slight tint + inner sheen.
  for (let ty = 0; ty < tilesAcross; ty++) {
    for (let tx = 0; tx < tilesAcross; tx++) {
      const x = tx * cell + grout * 0.5;
      const y = ty * cell + grout * 0.5;
      const w = cell - grout;
      const h = cell - grout;

      // Per-tile hue/brightness jitter around a bright cyan-blue.
      const hue = 200 + (rng() - 0.5) * 8;           // ~cyan-blue
      const sat = 85 + (rng() - 0.5) * 10;
      const light = 58 + (rng() - 0.5) * 10;

      const g = ctx.createLinearGradient(x, y, x, y + h);
      g.addColorStop(0, `hsl(${hue} ${sat}% ${light + 8}%)`);
      g.addColorStop(1, `hsl(${hue} ${sat}% ${light - 5}%)`);
      ctx.fillStyle = g;
      roundRect(ctx, x, y, w, h, Math.max(2, cell * 0.04));
      ctx.fill();

      // Soft top-left sheen (ceramic highlight)
      ctx.save();
      ctx.globalAlpha = 0.12 + rng() * 0.08;
      const sheen = ctx.createRadialGradient(
        x + w * 0.3, y + h * 0.28, 1,
        x + w * 0.3, y + h * 0.28, w * 0.9
      );
      sheen.addColorStop(0, '#ffffff');
      sheen.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = sheen;
      roundRect(ctx, x, y, w, h, Math.max(2, cell * 0.04));
      ctx.fill();
      ctx.restore();
    }
  }

  // Grout grid lines (lighter, slightly translucent) on top of the gaps.
  ctx.strokeStyle = 'rgba(224, 247, 255, 0.7)';
  ctx.lineWidth = grout;
  ctx.beginPath();
  for (let i = 0; i <= tilesAcross; i++) {
    const p = i * cell;
    ctx.moveTo(p, 0); ctx.lineTo(p, size);
    ctx.moveTo(0, p); ctx.lineTo(size, p);
  }
  ctx.stroke();

  // Faint mottling / dirt speckle for realism.
  ctx.save();
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 1400; i++) {
    const r = rng() * 2.2 + 0.3;
    ctx.fillStyle = rng() > 0.5 ? '#ffffff' : '#063a5e';
    ctx.beginPath();
    ctx.arc(rng() * size, rng() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  if (renderer) tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.needsUpdate = true;
  return tex;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
