# WebGPU + Web Worker + 3D demo

A PixiJS v8 app that renders an instanced 3D cube grid **entirely inside a Web Worker**, on WebGPU
(falls back to WebGL2 when the worker can't get a GPU adapter).

- The main thread calls `canvas.transferControlToOffscreen()` and hands the `OffscreenCanvas` to the worker.
- The worker calls `DOMAdapter.set(WebWorkerAdapter)` and creates a normal `Application` with `depth: true`.
- 3D is a plain Pixi `Mesh` with a custom `Shader` (WGSL + GLSL), a `State` with `depthTest`/`cullMode`,
  and an instanced `Geometry`: one draw call for every cube.
- Workers get no DOM events, so the main thread forwards pointer/wheel/resize messages (`src/protocol.ts`).
- A Pixi `Text` HUD is drawn on top of the 3D mesh in the same pass.
- **Block main thread for 3 s** freezes the main thread; the worker keeps animating.

## Run

`pixi.js` is aliased to this fork's compiled `lib/`, so build it first (or keep `npm run watch:lib` running
to pick up source changes):

```bash
# repo root
npm install
npm run build:lib

# this folder
cd demos/webgpu-worker-3d
npm install
npm run dev
```

Open the printed URL in a browser with WebGPU in workers (Chrome/Edge 113+, Safari 26+, Firefox 141+ on Windows).
Add `?renderer=webgl` to compare against WebGL2.

## Files

| File | Role |
| --- | --- |
| `src/main.ts` | Transfers the canvas, forwards input, shows main-thread vs worker FPS |
| `src/render.worker.ts` | Pixi app, camera, instanced mesh, HUD |
| `src/shaders.ts` | WGSL and GLSL shaders |
| `src/math.ts` | Small mat4 helpers (perspective, lookAt, multiply) |
| `src/protocol.ts` | Message types between the two threads |
