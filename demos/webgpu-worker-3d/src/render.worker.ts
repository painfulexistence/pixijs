/// <reference lib="webworker" />
import {
    Application,
    Buffer,
    BufferUsage,
    DOMAdapter,
    Geometry,
    GlProgram,
    GpuProgram,
    Mesh,
    Shader,
    State,
    Text,
    UniformGroup,
    WebWorkerAdapter,
} from 'pixi.js';
import { lookAt, multiply, perspective } from './math';
import { glFragment, glVertex, wgsl } from './shaders';

import type { FromWorker, ToWorker } from './protocol';

// Must run before any Pixi object is created: swaps DOM APIs for OffscreenCanvas & friends.
DOMAdapter.set(WebWorkerAdapter);

const post = (msg: FromWorker) => postMessage(msg);

let app: Application | null = null;
let mesh: Mesh<Geometry, Shader> | null = null;
let hud: Text | null = null;
let grid = 0;
// `init` is async, so resize/grid messages can arrive before the renderer exists: keep the latest.
let ready = false;
let pendingResize: Extract<ToWorker, { type: 'resize' }> | null = null;
let pendingGrid: number | null = null;

// ---------- orbit camera, driven by pointer events forwarded from the main thread ----------
const camera = { yaw: 0.6, pitch: 0.5, distance: 60, autoSpin: true };
const pointers = new Map<number, { x: number; y: number }>();

const proj = new Float32Array(16);
const view = new Float32Array(16);
const viewProj = new Float32Array(16);

const sceneUniforms = new UniformGroup({
    uViewProj: { value: viewProj, type: 'mat4x4<f32>' },
    uLightDir: { value: new Float32Array([0.4, 0.9, 0.3, 0]), type: 'vec4<f32>' },
    uTime: { value: 0, type: 'f32' },
});

// ---------- geometry ----------
function cubeVertices(size: number)
{
    const positions: number[] = [];
    const normals: number[] = [];
    const s = size / 2;
    const face = (n: number[], c: number[][]) =>
    {
        for (const i of [0, 1, 2, 0, 2, 3])
        {
            positions.push(...c[i]);
            normals.push(...n);
        }
    };

    face([1, 0, 0], [[s, -s, -s], [s, s, -s], [s, s, s], [s, -s, s]]);
    face([-1, 0, 0], [[-s, -s, s], [-s, s, s], [-s, s, -s], [-s, -s, -s]]);
    face([0, 1, 0], [[-s, s, -s], [-s, s, s], [s, s, s], [s, s, -s]]);
    face([0, -1, 0], [[-s, -s, s], [-s, -s, -s], [s, -s, -s], [s, -s, s]]);
    face([0, 0, 1], [[-s, -s, s], [s, -s, s], [s, s, s], [-s, s, s]]);
    face([0, 0, -1], [[s, -s, -s], [-s, -s, -s], [-s, s, -s], [s, s, -s]]);

    return { positions: new Float32Array(positions), normals: new Float32Array(normals) };
}

const cube = cubeVertices(1);

function buildGeometry(n: number): Geometry
{
    const count = n * n * n;
    const offsets = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const spacing = 2;
    const half = ((n - 1) * spacing) / 2;
    let i = 0;

    for (let x = 0; x < n; x++)
    {
        for (let y = 0; y < n; y++)
        {
            for (let z = 0; z < n; z++)
            {
                offsets[i] = (x * spacing) - half;
                offsets[i + 1] = (y * spacing) - half;
                offsets[i + 2] = (z * spacing) - half;
                colors[i] = 0.3 + (0.7 * x / Math.max(n - 1, 1));
                colors[i + 1] = 0.3 + (0.7 * y / Math.max(n - 1, 1));
                colors[i + 2] = 0.3 + (0.7 * z / Math.max(n - 1, 1));
                i += 3;
            }
        }
    }

    return new Geometry({
        attributes: {
            aPosition: { buffer: cube.positions, format: 'float32x3' },
            aNormal: { buffer: cube.normals, format: 'float32x3' },
            aOffset: {
                buffer: new Buffer({ data: offsets, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
                format: 'float32x3',
                instance: true,
            },
            aColor: {
                buffer: new Buffer({ data: colors, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST }),
                format: 'float32x3',
                instance: true,
            },
        },
        instanceCount: count,
    });
}

function setGrid(n: number)
{
    if (!mesh) return;
    grid = n;

    const old = mesh.geometry;

    mesh.geometry = buildGeometry(n);
    old.destroy(true);
    camera.distance = Math.max(20, n * 3.2);
}

// ---------- frame ----------
function updateCamera()
{
    const r = app!.renderer;
    const aspect = r.width / r.height;

    camera.pitch = Math.max(-1.4, Math.min(1.4, camera.pitch));
    const cp = Math.cos(camera.pitch);
    const eye: [number, number, number] = [
        camera.distance * cp * Math.sin(camera.yaw),
        camera.distance * Math.sin(camera.pitch),
        camera.distance * cp * Math.cos(camera.yaw),
    ];

    perspective(proj, Math.PI / 4, aspect, 0.1, 1000);
    lookAt(view, eye, [0, 0, 0], [0, 1, 0]);
    multiply(viewProj, proj, view);
    sceneUniforms.update();
}

async function init(msg: Extract<ToWorker, { type: 'init' }>)
{
    app = new Application();
    await app.init({
        canvas: msg.canvas,
        width: msg.width,
        height: msg.height,
        resolution: msg.resolution,
        preference: msg.preference,
        depth: true,
        antialias: true,
        background: '#0b0d17',
        // no DOM in a worker: Pixi's EventSystem has nothing to listen to
        eventMode: 'none',
    });

    const shader = new Shader({
        gpuProgram: GpuProgram.from({
            vertex: { source: wgsl, entryPoint: 'mainVert' },
            fragment: { source: wgsl, entryPoint: 'mainFrag' },
        }),
        glProgram: GlProgram.from({ vertex: glVertex, fragment: glFragment }),
        resources: { scene: sceneUniforms },
    });

    const state = new State();

    state.blendMode = 'none';
    state.depthTest = true;
    state.depthMask = true;
    state.cullMode = 'back';

    mesh = new Mesh({ geometry: buildGeometry(msg.grid), shader, state });
    grid = msg.grid;
    camera.distance = Math.max(20, grid * 3.2);
    app.stage.addChild(mesh);

    // Ordinary Pixi 2D content, drawn after the 3D mesh in the same pass.
    hud = new Text({
        text: 'PixiJS',
        style: { fill: '#ffffff', fontFamily: 'monospace', fontSize: 14, lineHeight: 20 },
    });
    hud.position.set(12, 12);
    app.stage.addChild(hud);

    const rendererName = app.renderer.name;
    let frames = 0;
    let last = performance.now();

    app.ticker.add((ticker) =>
    {
        if (camera.autoSpin) camera.yaw += 0.003 * ticker.deltaTime;
        sceneUniforms.uniforms.uTime += ticker.deltaMS / 1000;
        updateCamera();

        frames++;
        const now = performance.now();

        if (now - last >= 500)
        {
            const fps = (frames * 1000) / (now - last);
            const cubes = grid ** 3;

            hud!.text = `PixiJS ${rendererName} · rendered in a Web Worker\n`
                + `${cubes.toLocaleString()} cubes · 1 instanced draw call · ${fps.toFixed(0)} fps`;
            post({ type: 'stats', fps, cubes });
            frames = 0;
            last = now;
        }
    });

    ready = true;
    if (pendingResize) app.renderer.resize(pendingResize.width, pendingResize.height, pendingResize.resolution);
    if (pendingGrid !== null) setGrid(pendingGrid);
    pendingResize = null;
    pendingGrid = null;

    post({ type: 'ready', renderer: rendererName });
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
                if (ready) app!.renderer.resize(msg.width, msg.height, msg.resolution);
                else pendingResize = msg;
                break;
            case 'grid':
                if (ready) setGrid(msg.grid);
                else pendingGrid = msg.grid;
                break;
            case 'pointer': {
                if (msg.kind === 'down')
                {
                    pointers.set(msg.id, { x: msg.x, y: msg.y });
                    camera.autoSpin = false;
                }
                else if (msg.kind === 'move')
                {
                    const p = pointers.get(msg.id);

                    if (p)
                    {
                        camera.yaw -= (msg.x - p.x) * 0.005;
                        camera.pitch += (msg.y - p.y) * 0.005;
                        p.x = msg.x;
                        p.y = msg.y;
                    }
                }
                else
                {
                    pointers.delete(msg.id);
                }
                break;
            }
            case 'wheel':
                camera.distance = Math.max(5, Math.min(400, camera.distance * Math.exp(msg.deltaY * 0.001)));
                break;
        }
    }
    catch (err)
    {
        post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
};
