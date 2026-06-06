# Ripple Pond 🦆🎣

A top-down, physically-grounded **water game** built with **Three.js**, where the water is a true
GPU **wave simulation** (not a looping texture) — ripples propagate, interfere, reflect off the
walls, and decay.

**The game — Hunt the Fish:** shy fish hide at varying depths in the pool. Calm water is a bright
mirror that **camouflages** them; **disturb the surface and the refraction reveals dark fish
shapes** swimming below. But rippling also **spooks** them — they flee, dive, and avoid water you
recently touched. **Grab and fling the rubber duck** (real inertia; it glides and ricochets off
walls and beach balls) to **bump a fish** — each hit knocks it shallower until, near the surface,
it's caught and rolls belly-up. Catch them all to win. (A **Free Play** sandbox and the original
**duck-herding levels** remain as side modes.)

---

## Run it

ES-module import maps do **not** load from `file://`, so serve over http:

```bash
cd /Users/jerry/pool
python3 -m http.server 8080
# open http://localhost:8080
```

(Any static server works.) Requires a browser with **WebGL2 + float render targets**
(`EXT_color_buffer_float`) — every current Chrome/Edge/Firefox/Safari qualifies.

---

## Play (Hunt the Fish)

- **Ripple to see:** tap/drag empty water to disturb it — fish are only visible where the surface
  is broken up. Calm water hides them; deep fish stay faint even when revealed.
- **Grab & fling the duck:** press *on* the duck and drag — it follows with inertia; release to
  **throw** it. It glides, skids, and ricochets off the walls and the **beach balls** (use bank
  shots to reach fish in the corners).
- **Catch:** ram a fish with the duck to knock it shallower; repeated hits drive it to the
  surface, where it's caught and floats belly-up. **Catch them all to win.**
- **They're clever:** fish flee the duck, juke sideways when it closes (so you can't just chase),
  dive when scared, and avoid water you recently rippled. Disturb cleverly — every ripple both
  *reveals* and *warns* them.
- **Side modes:** **Free Play** (a calm sandbox) and the original **duck-herding levels**.

---

## The physics (theoretical grounding)

The whole effect is four classic techniques layered together. References at the bottom.

### 1. Ripples — damped 2-D wave equation (FDTD on the GPU)
The height field `h(x,y,t)` obeys `∂²h/∂t² + a·∂h/∂t = c²∇²h`. We solve it with an explicit
**leapfrog** scheme, storing current height in the texture's R channel and previous height in G,
ping-ponged each step via Three.js `GPUComputationRenderer` (`src/sim.js`):

```
h_new = ( hN + hS + hE + hW ) * 0.5  −  h_prev ,   then  × viscosity
```

The `0.5` is not arbitrary: it's the Courant factor `C² = 0.5`, i.e. `C = 1/√2`, which is the
exact **2-D CFL stability limit** (`c·Δt/Δx ≤ 1/√2`). At that value the `+2h` and `−4C²h` terms
of the general leapfrog cancel, giving the compact form above. `viscosity ≈ 0.97 (<1)` bleeds
energy so ripples decay. The sim runs on a **fixed timestep** (decoupled from frame rate) so the
wave speed is constant and never crosses the CFL limit. Walls use `ClampToEdge` sampling — a
zero-gradient (Neumann) boundary — so ripples **reflect** off the pool edges for free.

A touch isn't a single bump: it's an **oscillating tone-burst** (a damped sinusoid over ~8
frames) injected with a **Mexican-hat** profile `(1−x²)·e^(−x²)` — a dip ringed by a crest, i.e.
a real water-drop shape. The result is a *train of concentric rings* radiating out, like the
video, rather than one ring. The sim injects up to 8 such sources per step, so drag trails and
multiple touches interfere naturally.

### 2. Refraction — viewing the floor through the surface (`src/water.js`)
Surface normal from central differences of the height field:
`n = normalize(vec3((hL−hR)·W/B, (hD−hU)·W/B, 1))`. We then sample the tile texture at an
offset UV `floorUV + n.xy · depth` (Snell's law, the planar-water special case from Evan
Wallace's *WebGL Water*). That offset is what makes the grout grid look wavy.

### 3. Caustics — focused light (`src/caustics.js`, `src/water.js`)
Caustics are where the curved surface **focuses** sunlight; brightness ∝ the light's
area-compression (the Jacobian of the refractive map). The ever-present shimmer is a
**seamlessly tileable caustic texture baked once at startup** (the Dave-Hoskins field, whose
`mod(uv·TAU)` period makes `[0,1]` wrap perfectly). The water shader samples it with **two cheap
taps** — scrolled in opposite directions and nudged by the live surface normal — instead of
running the expensive per-pixel caustic loop every frame. That one change is both the *crispness*
win (bake at high res) and the *performance* win (≈5× cheaper → smooth at Retina DPR). A small
**surface-Laplacian** (`hN+hS+hE+hW−4h`) term is added so live ripples brighten locally.

### 4. Buoyancy & the wave-push (`src/duck.js`, `src/sim.js`)
A second tiny GPU pass samples the height + gradient at each floating body's UV, and one
`readRenderTargetPixels` call per frame reads them all back. Then:
- **Float:** `y = waterHeight + offset + bob`.
- **Tilt:** align the body's up-vector to the local surface normal.
- **Push:** buoyancy points along the normal `(−∂h/∂x, −∂h/∂y, 1)`, so the *horizontal*
  acceleration is `∝ −∇h` — the duck is shoved **down-slope**, away from a rising wavefront.
  Grab the duck and it's driven by a spring toward the pointer (laggy, floaty); release and it
  keeps its velocity → a throw that glides and bounces.

### 5. Hidden fish — revealed by disturbance (`src/underwater.js`, `src/fish.js`, `src/water.js`)
The fish are rendered into a **separate full-pool texture** (a dedicated ortho camera, perfectly
UV-aligned with the floor). The water shader samples that texture through the **same refraction**
as the floor, gated by a **clarity** term `clamp(base + surfaceSlope·reveal)`:
- **calm water** → slope ≈ 0 → clarity ≈ `base` (tiny) → fish are nearly invisible (camouflaged);
- **rippled water** → slope spikes → clarity jumps → fish shimmer into view;
- **depth** rides in the fish's alpha (deeper = fainter), so deep fish need *stronger* disturbance.

The beautiful part: the **same disturbance field** (`|height| + |slope|`) that the shader uses to
*reveal* a fish is what each fish *reads* to panic — so finding them and scaring them are one act.
Fish also flee the duck directly, **juke** sideways when it closes (no pinning), and steer away
from a decaying **memory grid** of recently-touched cells. A duck **bump** knocks a fish shallower
and it sinks back slowly, so hits **accumulate** it to the surface = a catch.

---

## Architecture

```
index.html      importmap (three r0.184.0), canvas, HUD/menu DOM
styles.css      UI styling
src/
  main.js       renderer, top-down ortho camera (cover-scaled), fixed-timestep loop, resize
  sim.js        WaterSim — FDTD heightmap + batched buoyancy readback (GPUComputationRenderer)
  caustics.js   bakeCausticTexture — one-time tileable caustic bake (crisp + fast)
  water.js      WaterSurface — shader: refraction + baked caustics + sun sparkle
  tiles.js      procedural tile-floor CanvasTexture (no image assets)
  underwater.js Underwater — fish rendered to a full-pool texture (revealed via refraction)
  fish.js       Fish agents (wander/flee/juke/dive + memory) + animated sprite + DisturbanceMemory
  duck.js       FloatingBody physics (float, wave-push, grab/throw) + procedural 3-D duck
  entities.js   ducklings, goal ring, drain & beach-ball obstacles
  levels.js     5 herding-level layouts (normalized coords)
  game.js       modes (hunt / herding / sandbox), fish & catch logic, collisions, scoring
  input.js      pointer/touch → raycast → ripples (+ stroke counting)
  ui.js         menu / level-select / HUD / win / sandbox overlays
  audio.js      optional procedural WebAudio blips
```

Everything is **self-contained** — tiles, duck, ducklings, and ball are all generated in code;
no binary assets.

## Tuning knobs

- Water look: `src/water.js` uniforms — `uRefract`, `uCaustic`, `uShallow/uDeep`, `uTintAmt`.
- Ripples: `src/sim.js` — `viscosity`, `substeps`, `grid`; injection strength in `src/input.js`.
- Duck feel: `src/game.js` player `push` / `drag`; `src/duck.js` `tiltAmt`, `bobAmp`.
- Performance: `GRID` auto-drops to 192 on small screens (`src/main.js`); device-pixel-ratio
  is clamped to 2.

## References

- three.js `GPUComputationRenderer` — https://threejs.org/docs/#examples/en/misc/GPUComputationRenderer
- three.js `webgl_gpgpu_water` example (FDTD heightmap + floating ducks) — https://github.com/mrdoob/three.js/blob/dev/examples/webgl_gpgpu_water.html
- Evan Wallace, *WebGL Water* — https://madebyevan.com/webgl-water/
- Evan Wallace, *Rendering Realtime Caustics in WebGL* — https://medium.com/@evanwallace/rendering-realtime-caustics-in-webgl-2a99a29a0b2c
- Maxime Heckel, *Caustics in WebGL* — https://blog.maximeheckel.com/posts/caustics-in-webgl/
- Gomez, *Interactive Water Surfaces* (Game Programming Gems) — damped height-field wave equation
- MDN, `EXT_color_buffer_float` — https://developer.mozilla.org/en-US/docs/Web/API/EXT_color_buffer_float
