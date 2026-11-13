# PixiJS 3D + WebGPU + Web Worker demo

A scene built with the official [`@pixi/3d`](https://www.npmjs.com/package/@pixi/3d) extension
(open beta, 0.1.0) that runs **entirely inside a Web Worker**, on WebGPU, falling back to WebGL2 when
the worker can't get a GPU adapter.

- The main thread calls `canvas.transferControlToOffscreen()` and gives the `OffscreenCanvas` to the worker.
- The worker sets `DOMAdapter.set(WebWorkerAdapter)` and creates a normal `Application`, a `View3D`, a sun with
  shadows, a ground plane, and a cube grid drawn by one `BatchedMesh3D`. A shader bit adds a colour per instance.
- The worker's CPU animates every instance's matrix each frame, so the main thread does none of that work.
- `OrbitCamera` and picking use pixi's federated events. A worker has no DOM, so `src/workerEvents.ts` adds a
  small bridge (see below). Click the sphere to change its colour.
- A pixi `Text` HUD is drawn over the 3D view in the same pass.
- **Block main thread for 3 s** freezes the main thread; the worker keeps animating.

## Run

`pixi.js` is aliased to this fork's compiled `lib/`, so build it first (or keep `npm run watch:lib` running
to pick up source changes). `@pixi/3d` 0.1.0 needs `pixi.js` 8.23.0 or later.

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

## Running pixi's EventSystem in a worker

`pixi.js/webworker` leaves the EventSystem out, because it listens to DOM events. The demo imports `pixi.js/events` and
supplies what that system needs:

| pixi expects | the worker gets |
| --- | --- |
| a `PointerEvent` global (checked when the renderer is created) | a small `Event` subclass carrying the copied fields |
| `document` for `pointermove` | an `EventTarget` stand-in |
| `getBoundingClientRect()` / `isConnected` on the canvas | set on the `OffscreenCanvas` from the CSS size |
| `pointerup` on `globalThis`, with `target === canvas` for a click | replayed on `globalThis` with `target` set |
| the CSS cursor to be set on the canvas | the worker posts `rootBoundary.cursor` to the main thread |

The main thread forwards `pointerdown/over/leave`, `wheel` and `contextmenu` from the canvas, and `pointermove/up/cancel`
from `window`, as plain data (`src/protocol.ts`).

## Files

| File | Role |
| --- | --- |
| `src/main.ts` | Transfers the canvas, forwards input, applies the cursor, shows main-thread and worker FPS |
| `src/render.worker.ts` | Pixi app, `@pixi/3d` scene, instance animation, HUD |
| `src/workerEvents.ts` | The EventSystem bridge described above |
| `src/protocol.ts` | Message types between the two threads |
