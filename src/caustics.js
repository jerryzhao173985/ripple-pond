import * as THREE from 'three';

/**
 * Bake a SEAMLESSLY TILEABLE caustic texture once, at startup.
 *
 * Why: the live water shader used to run the Dave-Hoskins caustic loop (10 sin/cos/length
 * iterations) per pixel, every frame — gorgeous but brutal at Retina DPR. Instead we render that
 * exact pattern ONCE into a texture, then the water shader samples it with two cheap texture taps.
 * Crisper (we can bake at high res) AND ~5× cheaper at runtime.
 *
 * Tileability: the Dave-Hoskins field uses `mod(uv*TAU, TAU)`, whose period is exactly `uv ∈ [0,1]`
 * — so the [0,1] render wraps seamlessly. We read it back into a CanvasTexture so mipmaps +
 * RepeatWrapping + anisotropy all "just work" (render-target mipmaps are finicky across drivers).
 */

const quadVert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Static (time = 0) slice of the tileable caustic field, as a grayscale intensity map.
const causticFrag = /* glsl */`
  precision highp float;
  varying vec2 vUv;
  #define TAU 6.28318530718
  #define ITER 5
  void main() {
    vec2 p = mod(vUv * TAU, TAU) - 250.0;
    vec2 i = vec2(p);
    float c = 1.0;
    float inten = 0.005;
    for (int n = 0; n < ITER; n++) {
      i = p + vec2(cos(i.x * -1.0) + sin(i.y), sin(i.y * -1.0) + cos(i.x));
      c += 1.0 / length(vec2(p.x / (sin(i.x) / inten), p.y / (cos(i.y) / inten)));
    }
    c /= float(ITER);
    c = 1.17 - pow(c, 1.4);
    float v = pow(abs(c), 8.0);
    gl_FragColor = vec4(vec3(v), 1.0);
  }
`;

export function bakeCausticTexture(renderer, size = 1024) {
  const rt = new THREE.WebGLRenderTarget(size, size, {
    type: THREE.UnsignedByteType,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });

  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader: causticFrag });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  scene.add(quad);

  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);

  const buf = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, size, size, buf);
  renderer.setRenderTarget(prev);

  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  img.data.set(buf);
  ctx.putImageData(img, 0, 0);

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  tex.colorSpace = THREE.NoColorSpace; // intensity data, not color
  tex.needsUpdate = true;

  quad.geometry.dispose();
  mat.dispose();
  rt.dispose();
  return tex;
}
