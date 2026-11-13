/// <reference lib="webworker" />
import { Application, DOMAdapter, Text, WebWorkerAdapter } from 'pixi.js';
// The webworker environment leaves out pixi's EventSystem (no DOM); bring it back for picking and OrbitCamera.
import 'pixi.js/events';
import {
    AmbientLight,
    BatchedMesh3D,
    Box,
    CubeGeometry,
    DirectionalLight,
    Material3D,
    Matrix4,
    Mesh3D,
    PlaneGeometry,
    RenderPassBit,
    SphereGeometry,
    View3D,
} from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { describeCanvasLayout, dispatchForwarded, installWorkerEventShims } from './workerEvents';

import type { ShaderBit } from '@pixi/3d';
import type { FromWorker, ToWorker } from './protocol';

// Must run before any pixi object is created: swaps DOM APIs for OffscreenCanvas & friends.
DOMAdapter.set(WebWorkerAdapter);
installWorkerEventShims();

const post = (msg: FromWorker) => postMessage(msg);

let app: Application | null = null;
let canvas: OffscreenCanvas | null = null;
let view: View3D | null = null;
let field: BatchedMesh3D | null = null;
let sun: DirectionalLight | null = null;
let orb: Mesh3D | null = null;
let grid = 0;
let ready = false;
// `init` is async, so these can arrive before the renderer exists: keep the latest.
let pendingResize: Extract<ToWorker, { type: 'resize' }> | null = null;
let pendingGrid: number | null = null;

const SPACING = 1.6;
const cube = new CubeGeometry({ width: 0.9, height: 0.9, depth: 0.9 });

// Per-instance colour: a vec4 field on the batch, read by a shader bit as `instance.tint`.
const tintBit: ShaderBit = {
    name: 'instanceTint',
    bindings: { instance: { tint: 'vec4<f32>' } },
    gpu: { fragment: { material: 'albedo *= instance.tint.rgb;' } },
    gl: { fragment: { material: 'albedo *= instance.tint.rgb;' } },
};
const cubeMaterial = new Material3D({ baseColor: 0xffffff, roughness: 0.45, metallic: 0.1, extraBits: [tintBit] });

// Grid offsets of every slot, read each frame to animate the matrices on the worker's CPU.
let seeds = new Float32Array(0);
const m = new Matrix4();
const pos = { x: 0, y: 0, z: 0 };

function buildField(n: number): BatchedMesh3D
{
    const count = n * n * n;
    const batch = new BatchedMesh3D({
        size: count,
        instanceData: { tint: { value: [1, 1, 1, 1], type: 'vec4<f32>' } },
    });
    const half = ((n - 1) * SPACING) / 2;
    const step = 1 / Math.max(n - 1, 1);

    seeds = new Float32Array(count * 3);

    for (let i = 0, x = 0; x < n; x++)
    {
        for (let y = 0; y < n; y++)
        {
            for (let z = 0; z < n; z++, i++)
            {
                seeds[i * 3] = (x * SPACING) - half;
                seeds[(i * 3) + 1] = (y * SPACING) + 1.5;
                seeds[(i * 3) + 2] = (z * SPACING) - half;

                batch.setGeometryAt(i, cube);
                batch.setMaterialAt(i, cubeMaterial);
                batch.setMatrixAt(i, m.makeRotationY(0).setPosition({
                    x: seeds[i * 3], y: seeds[(i * 3) + 1], z: seeds[(i * 3) + 2],
                }));
                batch.setInstanceDataAt(i, 'tint', 0.25 + (0.75 * x * step), 0.25 + (0.75 * y * step),
                    0.25 + (0.75 * z * step), 1);
                batch.setPassesAt(i, RenderPassBit.OPAQUE | RenderPassBit.SHADOW);
            }
        }
    }

    return batch;
}

function setGrid(n: number)
{
    grid = n;
    const old = field;

    field = buildField(n);
    view!.root.addChild(field);
    old?.destroy();

    // Park the clickable sphere just outside the grid.
    const half = ((n - 1) * SPACING) / 2;

    orb!.position.set(half + 5, 2, 0);

    // Past 256 casters the sun measures its shadow box once; give it a fixed box that covers
    // the grid at the top of its wave, plus the sphere.
    const size = (n * SPACING) + 14;

    sun!.shadow.bounds = Box.fromCenterSize({ x: 0, y: size / 2, z: 0 }, size);
}

function animate(time: number)
{
    if (!field) return;

    for (let i = 0; i < field.size; i++)
    {
        pos.x = seeds[i * 3];
        pos.z = seeds[(i * 3) + 2];
        const phase = (Math.hypot(pos.x, pos.z) * 0.25) - (time * 1.5);

        pos.y = seeds[(i * 3) + 1] + (Math.sin(phase) * 0.8);
        field.setMatrixAt(i, m.makeRotationY(phase).setPosition(pos));
    }
}

async function init(msg: Extract<ToWorker, { type: 'init' }>)
{
    canvas = msg.canvas;
    describeCanvasLayout(canvas, msg.width, msg.height);

    app = new Application();
    await app.init({
        canvas,
        width: msg.width,
        height: msg.height,
        resolution: msg.resolution,
        preference: msg.preference,
        antialias: true,
        background: '#0b0d17',
    });

    view = new View3D({
        autoResize: true,
        toneMapping: 'aces',
        shadowQuality: 'medium',
        environment: { skyColor: 0xb8c8ff, groundColor: 0x2a2236, intensity: 0.6 },
    });
    app.stage.addChild(view);

    sun = new DirectionalLight({ color: 0xfff2dc, intensity: 3.5, castShadow: true });

    sun.rotation.set(-Math.PI / 3, Math.PI / 5, 0);
    view.root.addChild(sun, new AmbientLight({ color: 0x8090ff, intensity: 0.3 }));

    const ground = new Mesh3D({
        geometry: new PlaneGeometry({ width: 200, height: 200 }),
        material: new Material3D({ baseColor: 0x1d2130, roughness: 1 }),
        receiveShadow: true,
        castShadow: false,
        parent: view.root,
    });

    ground.rotation.set(-Math.PI / 2, 0, 0);

    // A clickable sphere: forwarded pointer events reach pixi's picking inside the worker.
    const orbColors = [0xff5a5f, 0xffc145, 0x5bc0eb, 0x9bc53d, 0xc06cff];
    let orbColor = 0;
    const orbMaterial = new Material3D({ baseColor: orbColors[0], roughness: 0.2, metallic: 0.3 });

    orb = new Mesh3D({
        geometry: new SphereGeometry({ radius: 2 }),
        material: orbMaterial,
        castShadow: true,
        eventMode: 'static',
        cursor: 'pointer',
        parent: view.root,
    });

    orb.on('pointertap', (e) =>
    {
        if (e.button !== 0) return;
        orbColor = (orbColor + 1) % orbColors.length;
        orbMaterial.baseColor = orbColors[orbColor];
    });

    setGrid(msg.grid);

    view.camera.far = 2000;
    view.camera.position.set(0, grid * 1.4, grid * 3.2);
    const orbit = new OrbitCamera({
        view,
        target: { x: 0, y: 2, z: 0 },
        enableDamping: true,
        autoRotate: true,
        autoRotateSpeed: 0.5,
        minDistance: 6,
        maxDistance: 400,
        autoUpdate: false,
    });

    // 2D HUD on top of the 3D view, drawn by the same renderer.
    const hud = new Text({
        text: 'PixiJS 3D',
        style: { fill: '#ffffff', fontFamily: 'monospace', fontSize: 14, lineHeight: 20 },
    });

    hud.position.set(12, 12);
    app.stage.addChild(hud);

    const rendererName = app.renderer.name;
    let time = 0;
    let frames = 0;
    let last = performance.now();
    let lastCursor = '';

    app.ticker.add((ticker) =>
    {
        time += ticker.deltaMS / 1000;
        animate(time);
        orbit.update(ticker);

        // An OffscreenCanvas has no style: hand the hover cursor to the main thread.
        const cursor = app!.renderer.events.rootBoundary.cursor ?? 'default';

        if (cursor !== lastCursor)
        {
            lastCursor = cursor;
            post({ type: 'cursor', cursor });
        }

        frames++;
        const now = performance.now();

        if (now - last >= 500)
        {
            const fps = (frames * 1000) / (now - last);
            const cubes = grid ** 3;

            hud.text = `@pixi/3d on ${rendererName} · rendered in a Web Worker\n`
                + `${cubes.toLocaleString()} cubes in one BatchedMesh3D · ${fps.toFixed(0)} fps\n`
                + 'click the sphere';
            post({ type: 'stats', fps, cubes });
            frames = 0;
            last = now;
        }
    });

    ready = true;
    if (pendingResize) resize(pendingResize);
    if (pendingGrid !== null) setGrid(pendingGrid);
    pendingResize = null;
    pendingGrid = null;

    post({ type: 'ready', renderer: rendererName });
}

function resize({ width, height, resolution }: { width: number; height: number; resolution: number })
{
    describeCanvasLayout(canvas!, width, height);
    app!.renderer.resize(width, height, resolution);
}

self.onmessage = async (e: MessageEvent<ToWorker>) =>
{
    const msg = e.data;

    try
    {
        switch (msg.type)
        {
            case 'init':
                await init(msg);
                break;
            case 'resize':
                if (ready) resize(msg);
                else pendingResize = msg;
                break;
            case 'grid':
                if (ready) setGrid(msg.grid);
                else pendingGrid = msg.grid;
                break;
            case 'event':
                if (ready) dispatchForwarded(canvas!, msg.event);
                break;
        }
    }
    catch (err)
    {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
};
