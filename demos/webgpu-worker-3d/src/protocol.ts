/** A DOM input event copied to plain data so it can cross to the worker. */
export interface ForwardedEvent
{
    type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel' | 'pointerover' | 'pointerleave'
        | 'wheel' | 'contextmenu';
    init: Record<string, number | string | boolean>;
    /** Whether the original event's target was the canvas (pixi tells `pointerup` from `pointerupoutside` by it) */
    onCanvas: boolean;
}

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
    | { type: 'event'; event: ForwardedEvent };

/** Messages the render worker sends back to the main thread. */
export type FromWorker =
    | { type: 'ready'; renderer: string }
    | { type: 'stats'; fps: number; cubes: number }
    | { type: 'cursor'; cursor: string }
    | { type: 'error'; message: string };
