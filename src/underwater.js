import * as THREE from 'three';

/**
 * Underwater — renders the "things below the surface" (the fish) into an offscreen texture that
 * spans the WHOLE pool, perfectly aligned with the floor's UVs. The water shader then samples
 * this texture through the same refraction as the floor, so fish are only revealed where the
 * surface is disturbed (see water.js `clarity`).
 *
 * A dedicated orthographic camera covers exactly [-bounds/2, bounds/2] in X and Y (matching the
 * water plane's UV space) so a fish at world (x,y) lands at texture uv ((x/b)+0.5, (y/b)+0.5).
 */
export class Underwater {
  constructor(renderer, { bounds, size = 1024 }) {
    this.renderer = renderer;
    this.scene = new THREE.Scene();
    const h = bounds / 2;
    this.camera = new THREE.OrthographicCamera(-h, h, h, -h, -5, 5);
    this.camera.position.set(0, 0, 2);
    this.camera.lookAt(0, 0, 0);

    this.rt = new THREE.WebGLRenderTarget(size, size, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false,
    });

    this.fishGroup = new THREE.Group();
    this.scene.add(this.fishGroup);
  }

  get texture() { return this.rt.texture; }

  add(mesh) { this.fishGroup.add(mesh); }
  remove(mesh) { this.fishGroup.remove(mesh); }

  render() {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const prevClear = r.getClearColor(new THREE.Color());
    const prevAlpha = r.getClearAlpha();
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);   // transparent → floor shows where there's no fish
    r.clear();
    r.render(this.scene, this.camera);
    r.setRenderTarget(prevRT);
    r.setClearColor(prevClear, prevAlpha);
  }
}
