import * as THREE from 'three';

/**
 * WaterSurface — one full-pool plane that renders the tiled floor AS SEEN THROUGH the rippling
 * water. Lighting model (all physically motivated, see README):
 *
 *   normal     = central differences of the height field
 *   refraction = sample floor at  uv + n.xy * refractStrength      (Snell, planar case)
 *   caustics   = two scrolled taps of a BAKED tileable caustic texture, nudged by the surface
 *                normal, + a small (−∇²h) focus term so live ripples brighten locally
 *   shading    = soft sun sparkle + faint fresnel.  NO trough-darkening (that caused black blobs).
 */

const vert = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const frag = /* glsl */`
  precision highp float;
  varying vec2 vUv;

  uniform sampler2D uHeight;
  uniform sampler2D uFloor;
  uniform sampler2D uCausticTex;
  uniform sampler2D uFishTex;
  uniform float uBaseClarity;   // how visible submerged things are when calm (small)
  uniform float uReveal;        // how much disturbance reveals the depths
  uniform float uTime;
  uniform float uGrid;
  uniform float uBounds;
  uniform float uRefract;
  uniform float uCausticScale;
  uniform float uCausticStrength;
  uniform float uRippleFocus;
  uniform vec3  uSun;
  uniform vec3  uCausticColor;

  float H(vec2 uv) { return texture2D(uHeight, uv).x; }

  void main() {
    vec2 uv = vUv;
    vec2 texel = vec2(1.0 / uGrid);

    float hC = H(uv);
    float hL = H(uv - vec2(texel.x, 0.0));
    float hR = H(uv + vec2(texel.x, 0.0));
    float hD = H(uv - vec2(0.0, texel.y));
    float hU = H(uv + vec2(0.0, texel.y));

    float gradScale = uGrid / uBounds;
    vec3 n = normalize(vec3((hL - hR) * gradScale, (hD - hU) * gradScale, 1.0));

    // Refract the floor lookup by the surface tilt (gentle).
    vec2 floorUv = uv + n.xy * uRefract;
    vec3 col = texture2D(uFloor, floorUv).rgb;

    // Submerged things (fish) are revealed only where the surface is disturbed: calm water
    // camouflages them, a ripple's slope clears the view. Deeper fish carry less alpha.
    vec4 fishC = texture2D(uFishTex, floorUv + n.xy * (uRefract * 1.6));
    float slope = length(n.xy);
    float clarity = clamp(uBaseClarity + slope * uReveal, 0.0, 1.0);
    col = mix(col, fishC.rgb, fishC.a * clarity);

    // Caustics: two scrolled taps of the baked tile, disturbed by the live surface normal.
    float t = uTime;
    vec2 f1 = vec2( t * 0.013,  t * 0.009);
    vec2 f2 = vec2(-t * 0.010,  t * 0.012);
    vec2 cuv = floorUv * uCausticScale;
    float c1 = texture2D(uCausticTex, cuv + f1 + n.xy * 0.6).r;
    float c2 = texture2D(uCausticTex, cuv * 1.37 + f2 - n.xy * 0.6).r;
    float caustic = (c1 + c2) * 0.5 + c1 * c2 * 1.6;   // network + bright crossings

    // Live ripples focus light (concave water → brighter), purely additive — never darkens.
    float lap = (hL + hR + hD + hU - 4.0 * hC);
    caustic += max(0.0, -lap) * uRippleFocus;

    col += caustic * uCausticStrength * uCausticColor;

    // Very subtle, symmetric refraction shimmer (bounded so it never goes dark).
    col *= 1.0 + clamp((hR - hL) * gradScale * 0.06, -0.06, 0.06);

    // Soft sun sparkle on crests.
    vec3 halfway = normalize(uSun + vec3(0.0, 0.0, 1.0));
    float spec = pow(max(dot(n, halfway), 0.0), 120.0);
    col += spec * vec3(1.0, 1.0, 0.96) * 0.5;

    // Faint sky fresnel where the surface tilts.
    float fres = pow(1.0 - n.z, 3.0);
    col = mix(col, vec3(0.85, 0.95, 1.0), fres * 0.06);

    // Subtle large-scale depth variation so the pool isn't perfectly uniform.
    float depthVar = sin(uv.x * 3.1 + 1.3) * sin(uv.y * 2.7 - 0.6);
    col *= 1.0 + depthVar * 0.03;

    col *= 1.04;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class WaterSurface {
  constructor({ floorTex, causticTex, grid, bounds }) {
    this.uniforms = {
      uHeight: { value: null },
      uFloor: { value: floorTex },
      uCausticTex: { value: causticTex },
      uFishTex: { value: null },
      uBaseClarity: { value: 0.1 },
      uReveal: { value: 5.5 },
      uTime: { value: 0 },
      uGrid: { value: grid },
      uBounds: { value: bounds },
      uRefract: { value: 0.026 },
      uCausticScale: { value: 5.5 },
      uCausticStrength: { value: 0.32 },
      uRippleFocus: { value: 5.0 },
      uSun: { value: new THREE.Vector3(0.45, 0.5, 0.75).normalize() },
      uCausticColor: { value: new THREE.Color(0.62, 0.9, 1.0) },
    };

    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      uniforms: this.uniforms,
    });

    const geo = new THREE.PlaneGeometry(bounds, bounds, 1, 1);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'water';
  }

  update(time, heightTexture) {
    this.uniforms.uTime.value = time;
    this.uniforms.uHeight.value = heightTexture;
  }
}
