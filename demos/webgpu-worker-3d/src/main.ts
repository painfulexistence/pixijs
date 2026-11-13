import type { FromWorker, ToWorker } from './protocol';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const status = document.getElementById('status')!;
const mainFps = document.getElementById('main-fps')!;
const workerFps = document.getElementById('worker-fps')!;
const gridInput = document.getElementById('grid') as HTMLInputElement;
const gridLabel = document.getElementById('grid-label')!;
const blockBtn = document.getElementById('block') as HTMLButtonElement;

const params = new URLSearchParams(location.search);
const preference = params.get('renderer') === 'webgl' ? 'webgl' : 'webgpu';

function fail(message: string)
{
    console.warn(message);
    status.textContent = message;
    status.classList.add('error');
}

if (!('transferControlToOffscreen' in HTMLCanvasElement.prototype))
{
    fail('This browser cannot transfer a canvas to a worker (OffscreenCanvas).');
    throw new Error('OffscreenCanvas unsupported');
}

const worker = new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
const send = (msg: ToWorker, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);

worker.onmessage = (e: MessageEvent<FromWorker>) =>
{
    const msg = e.data;

    if (msg.type === 'ready')
    {
        status.textContent = `Worker renderer: ${msg.renderer}`
            + `${preference === 'webgpu' && msg.renderer !== 'webgpu' ? ' (WebGPU unavailable, fell back)' : ''}`;
    }
    else if (msg.type === 'stats')
    {
        workerFps.textContent = `${msg.fps.toFixed(0)} fps`;
    }
    else
    {
        fail(`Worker error: ${msg.message}`);
    }
};
worker.onerror = (e) => fail(`Worker failed to start: ${e.message}`);

// Hand the canvas over: from now on only the worker can draw to it.
const size = () => ({ width: canvas.clientWidth, height: canvas.clientHeight, resolution: Math.min(devicePixelRatio, 2) });
const offscreen = canvas.transferControlToOffscreen();

send({ type: 'init', canvas: offscreen, preference, grid: Number(gridInput.value), ...size() }, [offscreen]);

new ResizeObserver(() => send({ type: 'resize', ...size() })).observe(canvas);

// Workers get no DOM events, so forward the ones the camera needs.
const pointer = (kind: 'down' | 'move' | 'up') => (e: PointerEvent) =>
{
    if (kind === 'down') canvas.setPointerCapture(e.pointerId);
    send({ type: 'pointer', kind, x: e.offsetX, y: e.offsetY, id: e.pointerId });
};

canvas.addEventListener('pointerdown', pointer('down'));
canvas.addEventListener('pointermove', pointer('move'));
canvas.addEventListener('pointerup', pointer('up'));
canvas.addEventListener('pointercancel', pointer('up'));
canvas.addEventListener('wheel', (e) =>
{
    e.preventDefault();
    send({ type: 'wheel', deltaY: e.deltaY });
}, { passive: false });

const updateGridLabel = () =>
{
    const n = Number(gridInput.value);

    gridLabel.textContent = `${n}³ = ${(n ** 3).toLocaleString()} cubes`;
};

updateGridLabel();
gridInput.addEventListener('input', updateGridLabel);
gridInput.addEventListener('change', () => send({ type: 'grid', grid: Number(gridInput.value) }));

// Prove the point: freeze the main thread and watch the worker keep rendering.
blockBtn.addEventListener('click', () =>
{
    blockBtn.disabled = true;
    setTimeout(() =>
    {
        const end = performance.now() + 3000;

        while (performance.now() < end) { /* busy-wait */ }
        blockBtn.disabled = false;
    }, 50);
});

// Main-thread frame rate, for comparison with the worker's.
let frames = 0;
let last = performance.now();
const tick = (now: number) =>
{
    frames++;
    if (now - last >= 500)
    {
        mainFps.textContent = `${((frames * 1000) / (now - last)).toFixed(0)} fps`;
        frames = 0;
        last = now;
    }
    requestAnimationFrame(tick);
};

requestAnimationFrame(tick);
