/** Messages the main thread sends to the render worker. */
export type ToWorker =
    | {
        type: 'init';
        canvas: OffscreenCanvas;
        width: number;
        height: number;
        resolution: number;
        preference: 'webgpu' | 'webgl';
        grid: number;
    }
    | { type: 'resize'; width: number; height: number; resolution: number }
    | { type: 'grid'; grid: number }
    | { type: 'pointer'; kind: 'down' | 'move' | 'up'; x: number; y: number; id: number }
    | { type: 'wheel'; deltaY: number };

/** Messages the render worker sends back to the main thread. */
export type FromWorker =
    | { type: 'ready'; renderer: string }
    | { type: 'stats'; fps: number; cubes: number }
    | { type: 'error'; message: string };
