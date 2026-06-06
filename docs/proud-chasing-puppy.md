# Plan: "Ripple Pond" — Top-Down Interactive Pool Water Game (Three.js)

## Context

The user wants a browser game (Three.js) that recreates the animation in their reference
video (`/Users/jerry/Downloads/01ea213c103c5ba9010370039e91f9ce9b_4610.mp4video.MP4`,
720×720, 30fps, ~30s). I extracted 59 frames and analyzed them. The video shows a
**top-down swimming pool**: blue ceramic tiles with white grout (a grid) on the floor,
viewed **through a rippling water surface** so the grid looks wavy (refraction); bright
shimmering **caustics** dance on the floor; a **yellow rubber duck** floats, bobs, tilts
and drifts; and **touching/moving the pointer spawns concentric ripple rings** that
propagate, interfere and decay. (The `小红书` logo + username in the video are
screen-recording watermarks and are NOT part of the build.)

The user explicitly asked for **theoretical grounding** and **correct animation**, a
**full game** (not just the toy), a **procedural 3D duck**, and a **modular project folder**.

The intended outcome: a polished, physically-grounded, 60fps water game where you create
ripples to herd a rubber duck across a tiled pool — faithful to the video's look, with a
real game layer (levels, collectibles, goal, scoring) plus a free-play sandbox that is the
pure video-like experience.

This is **greenfield**: `/Users/jerry/pool` is empty (only `.omc/`). No existing code to reuse.

## Theoretical grounding (the physics we implement)

Verified against current docs/examples (June 2026). The canonical reference is the official
three.js `webgl_gpgpu_water` example, which already implements an FDTD height-field on
`GPUComputationRenderer` with normals-from-heightmap **and floating rubber ducks** via a
`readWaterLevel` GPU→CPU readback. We adapt it from a 3D ocean to a **top-down tiled pool**.

1. **Ripple simulation — damped 2D wave equation (FDTD, leapfrog, ping-pong).**
   PDE: `∂²h/∂t² + a·∂h/∂t = c²∇²h`. Discretized update (store current height in R,
   previous in G of a float texture, ping-pong each step):
   `h(t+Δt) = 2h(t) − h(t−Δt) + (cΔt/Δx)²·(hN+hS+hE+hW − 4h)`, then `×damping`.
   - **CFL stability:** explicit scheme is stable only if Courant `cΔt/Δx ≤ 1/√2 ≈ 0.707`
     in 2D — that's why the canonical compact form uses a `×0.5` neighbor factor and a
     `viscosity ≈ 0.93` multiplier. We keep effective Courant ≤ ~0.7, damping ∈ [0.9, 0.999],
     and step the sim on a **fixed timestep** so wave speed is FPS-independent.
   - **Touch injection:** add a smooth half-cosine bump to the height at the pointer UV.

2. **Surface normal — central differences of the height field.**
   `n = normalize(vec3((hL−hR)·W/B, (hD−hU)·W/B, 1.0))` where `W=grid size`, `B=world size`.

3. **Refraction of the tiled floor — Snell, planar-water special case (Evan Wallace).**
   Sample the floor texture at an offset UV: `floorUV + n.xy · depth · refractStrength`.
   This bends the grout grid exactly like the video. (`eta = n_air/n_water ≈ 0.75` if using
   GLSL `refract()`; we use the cheaper, stable planar UV-offset approximation.)

4. **Caustics — light area-compression.**
   Physically: brightness = Jacobian of the refractive displacement map (`dFdx`/`dFdy` of the
   refracted floor position) — light focused into a smaller area is brighter. We use the
   cheaper, equivalent-in-spirit **surface Laplacian** read straight from the heightmap
   (`hN+hS+hE+hW−4h`): concave surface → focus → bright ribbons; plus a subtle scrolling
   secondary layer for ambient shimmer when calm.

5. **Buoyancy & wave-driven motion (the game mechanic).**
   For each floating body, read back the height texture at its UV (height + gradient normal):
   set `y = waterHeight + floatOffset`; tilt the body so its up-vector = local surface normal;
   apply **horizontal acceleration ∝ −∇h** (the surface-tilt push). Integrate velocity with
   water drag. Result: ripples physically shove the duck — tap behind it to push it forward.

Sources: three.js GPUComputationRenderer docs; `webgl_gpgpu_water` example; Evan Wallace
*WebGL Water* + *Rendering Realtime Caustics in WebGL*; Maxime Heckel *Caustics in WebGL*;
Gomez *Interactive Water Surfaces* (Game Programming Gems); MDN `EXT_color_buffer_float`.
(Full URLs collected during research; will be cited in README.md.)

## The game: "Ripple Pond"

You don't drag the duck — you **make waves** that push it (the emergent physics above).

- **Free Play (sandbox):** the pure video experience — endless calm pool, ambient caustics,
  one duck that bobs/drifts, touch/drag anywhere for ripples. A button to drop extra ducks.
- **Play (levels):** herd the rubber duck to **collect scattered ducklings**, then reach the
  glowing **home ring**. Relaxed (no hard fail); scored on **strokes (ripples used) + time**
  → 1–3 stars. Progression across **5 hand-crafted levels** of increasing challenge:
  later levels add a **drain hazard** (pulls the duck — avoid) and **floating obstacles**
  (the duck bumps off them, spawning ripples). Walls bounce the duck (and ripple on impact).
- **HUD/overlays:** clean minimal DOM (level #, ducklings left, strokes/time, star result,
  menu/level-select/win screens) — deliberately unlike the video's recording watermarks.
- Stretch (noted, not MVP): ducklings that *follow* the mama duck once collected; sound.

## Architecture — modular static project

Served over http (ES-module importmaps don't load from `file://`). One-command run:
`cd /Users/jerry/pool && python3 -m http.server 8080` → open `http://localhost:8080`.

```
/Users/jerry/pool/
  index.html        # importmap (three r0.184.0 via jsDelivr), <canvas>, HUD DOM, loads src/main.js
  styles.css        # HUD / menu / overlay styling (clean, minimal)
  src/
    main.js         # bootstrap: WebGLRenderer, scene, top-down OrthographicCamera, lights,
                    #   fixed-timestep loop, wires sim+water+game+input+ui; WebGL/float-support guard
    sim.js          # WaterSim — GPUComputationRenderer: heightmap FDTD pass + batched
                    #   readWaterLevel pass. API: inject(uv,strength), step(dt),
                    #   sampleBodies(uvArray)->[{height,nx,ny}], get heightTexture
    water.js        # WaterSurface — full-screen plane + ShaderMaterial (refraction + caustics
                    #   + depth tint + fresnel/specular highlight). Consumes heightTexture + floor tex
    tiles.js        # makeTileTexture() -> THREE.CanvasTexture (blue tiles, grout grid, per-tile
                    #   variation, subtle dirt) — fully procedural, no assets
    duck.js         # FloatingBody base (buoyancy/physics/tilt) + makeDuck() procedural 3D mesh
                    #   (body + head + beak + eyes) with soft contact-shadow sprite
    entities.js     # ducklings (collectibles), home ring (goal), drain + obstacle hazards —
                    #   all FloatingBody instances
    levels.js       # LEVELS: array of {duckStart, ducklings[], goal, hazards[], parStrokes, parTime}
    game.js         # GameState — mode (menu/play/sandbox), force model, collisions, collect
                    #   detection, scoring/stars, level transitions, win handling
    input.js        # pointer (mouse+touch) -> raycast to pool plane -> UV; drag trail -> ripples;
                    #   stroke counting; respects UI clicks
    ui.js           # DOM HUD updates + menu / level-select / win overlays
    audio.js        # OPTIONAL procedural WebAudio sfx (plip/collect/win); muted by default
  README.md         # run instructions + the physics/theory writeup (grounding) + sources
```

Shaders are inline template-literal GLSL strings inside `sim.js` / `water.js` (no fetch needed).

### Render loop order (fixed-timestep accumulator)

1. `input` drains queued ripple points → `sim.inject(uv, strength)` for each.
2. `sim.step(dt)` — `gpu.compute()` on the heightmap (fixed sim dt for stable wave speed).
3. `sim.sampleBodies()` — ONE batched `readWaterLevel` pass + a SINGLE `readRenderTargetPixels`
   covering all floating bodies (avoids per-object GPU stalls) → height + normal per body.
4. `game.update(dt)` — apply wave push (∝ normal.xy), hazard forces, integrate velocities w/
   drag, wall bounce (+ripple), collisions, duckling collect, goal/win checks, scoring.
5. Sync meshes (position.y = waterHeight+offset, tilt to normal, gentle yaw spin); update shadows.
6. `water` uniforms (time, heightTexture); `renderer.render(scene, camera)`.
7. `ui.update()`.

### Key uniforms

- **sim heightmap shader:** `heightmap` (self-dep), `mousePos`, `mouseSize`, `strength`,
  `viscosity`, `texelSize`, `bounds`.
- **readWaterLevel shader:** `heightmap`, `points[]` (body UVs), `texelSize`, `W/B`.
- **water surface shader:** `heightmap`, `floorTex`, `time`, `W`, `B`, `depth`,
  `refractStrength`, `causticStrength`, `waterColorShallow`, `waterColorDeep`, `sunDir`,
  `tileScroll`, `dpr`.

### Camera / lighting / floor

- **OrthographicCamera** straight top-down (matches the video's flat look); optional ~5° tilt
  toggle for a hint of 3D on the duck.
- **DirectionalLight** (soft) for duck depth; **AmbientLight** fill. Duck shadow = a soft
  radial dark sprite under the duck (cheap, reliable, matches the video's contact shadow) —
  not a shadow-map receiver on the shader plane.
- The **floor is baked into the water shader** (one opaque full-screen plane = floor seen
  through water). The duck + entities are separate meshes above it.

## Risks / gotchas

- **Float render targets (WebGL2):** rendering to float needs `EXT_color_buffer_float`;
  GPUComputationRenderer auto-handles when it owns the context. Guard at startup; fall back to
  `HalfFloatType` (decode readback as needed) or show a friendly message if unsupported.
  Keep the FDTD sim on full `FloatType` for stability/precision.
- **Readback stalls:** `readRenderTargetPixels` is a synchronous GPU→CPU stall. Batch ALL
  bodies into one small target + one readback per frame (not one per object).
- **CFL / blow-up:** keep neighbor factor ≤ 0.5 + viscosity < 1; fixed sim timestep.
- **`file://` won't load modules:** must serve over http — document the one-liner + note in README.
- **Retina:** clamp `devicePixelRatio` to ≤ 2; sim grid (128–256) is decoupled from screen res.
- **Resize:** update ortho frustum + renderer size; sim grid stays fixed.
- **Perf scaling:** grid 256 on desktop, auto-drop to 128 on mobile/low-FPS.
- **No external assets:** tiles + duck + ducklings all procedural (self-contained).
- **Do NOT** reproduce the video's `小红书`/username watermark overlays.

## Build phases (executor sequence)

1. Scaffold: `index.html` + importmap (r0.184.0) + `styles.css` + `main.js` renderer/ortho
   camera/lights/loop + WebGL/float guard. Verify a blank blue plane renders.
2. `tiles.js` procedural tile texture; render it on the plane (no water yet) to validate look.
3. `sim.js` heightmap FDTD pass + `inject`; `water.js` shader doing refraction of the tile
   texture from the heightmap. Verify pointer ripples distort the grid like the video.
4. Caustics + depth tint + fresnel/specular in the water shader; ambient idle ripples. Tune
   to match the video's brightness/shimmer.
5. `duck.js` procedural duck + buoyancy via batched `readWaterLevel`; floats/bobs/tilts/drifts;
   soft shadow. Verify ripples push the duck (force model sign calibrated).
6. `entities.js` ducklings/goal/hazards + `game.js` force model, collisions, collect, scoring;
   `levels.js` 5 levels; `input.js` strokes; `ui.js` menu/HUD/win + free-play sandbox.
7. Polish: star ratings, transitions, optional `audio.js`, perf auto-scale, mobile touch.
8. `README.md` run instructions + theory writeup + sources.

## Verification (end-to-end)

- Run `python3 -m http.server 8080` in `/Users/jerry/pool`; open `http://localhost:8080`.
- Use the Playwright MCP (`browser_navigate`, `browser_take_screenshot`, `browser_click`,
  `browser_evaluate`) to: confirm no console errors / WebGL ok; screenshot idle pool (tiles +
  caustics) and compare against extracted frames in `/tmp/pool_frames/`; click/drag to
  confirm ripple rings distort the grid and the duck gets pushed; play a level to verify
  collect → goal → win + scoring; check resize + (emulated) touch.
- Visual parity check vs `/tmp/montage_A|B|C.jpg` and `f_021.jpg` / `f_043.jpg`.
- Confirm 60fps (or graceful auto-scale) and no readback hitching with multiple bodies.

## Definition of done (visual + functional)

- [ ] Top-down tiled pool; grout grid visibly **refracts/waves** through the surface.
- [ ] **Caustics** shimmer continuously on the floor; gentle ambient ripples when idle.
- [ ] Pointer/touch **drag spawns concentric ripples** that propagate, interfere, decay.
- [ ] Procedural **rubber duck** floats, bobs, tilts, drifts, soft shadow; **ripples push it**.
- [ ] Full game: 5 levels (collect ducklings → reach home), strokes/time scoring + stars,
      menu / level-select / win overlays, plus a **Free Play** sandbox = the video experience.
- [ ] 60fps target with float-support fallback; runs via one `http.server` command.
- [ ] README documents how to run + the wave/refraction/caustics/buoyancy theory + sources.
