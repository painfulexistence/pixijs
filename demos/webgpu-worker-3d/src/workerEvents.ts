/// <reference lib="webworker" />
/**
 * Lets pixi's EventSystem run inside a Web Worker.
 *
 * A worker has no DOM: no `document`, no `PointerEvent`, and an OffscreenCanvas never receives input.
 * The EventSystem listens for `pointerdown`/`wheel`/`contextmenu` on its target element, `pointermove`
 * on `document` and `pointerup` on `globalThis`. This module supplies just enough of that surface,
 * and `dispatchForwarded` replays the pointer data the main thread posts to the same targets,
 * so federated events, picking and `@pixi/3d`'s OrbitCamera work unchanged.
 *
 * Call `installWorkerEventShims()` before `app.init()`, since the EventSystem checks for
 * `PointerEvent` when it is constructed.
 */

import type { ForwardedEvent } from './protocol';

/** Minimal `PointerEvent`/`WheelEvent` stand-in: an Event carrying the copied fields. */
class ForwardedPointerEvent extends Event
{
    constructor(type: string, init: Record<string, unknown> = {})
    {
        super(type, { bubbles: true, cancelable: true });
        Object.assign(this, {
            clientX: 0,
            clientY: 0,
            button: 0,
            buttons: 0,
            pointerId: 1,
            pointerType: 'mouse',
            isPrimary: true,
            width: 1,
            height: 1,
            pressure: 0,
            tangentialPressure: 0,
            tiltX: 0,
            tiltY: 0,
            twist: 0,
            altKey: false,
            ctrlKey: false,
            metaKey: false,
            shiftKey: false,
            movementX: 0,
            movementY: 0,
            deltaX: 0,
            deltaY: 0,
            deltaZ: 0,
            deltaMode: 0,
            ...init,
        });
    }
}

const fakeDocument = new EventTarget();

/** Installs `document` and `PointerEvent` stand-ins on the worker's global scope. */
export function installWorkerEventShims(): void
{
    const g = globalThis as Record<string, unknown>;

    g.PointerEvent ??= ForwardedPointerEvent;
    g.document ??= fakeDocument;
}

/**
 * Makes the OffscreenCanvas answer the layout questions pixi asks of its target element,
 * so client coordinates map to the CSS-pixel size of the on-page canvas.
 * @param canvas - The canvas the renderer draws to and the EventSystem listens on.
 * @param cssWidth - Width of the on-page canvas in CSS pixels.
 * @param cssHeight - Height of the on-page canvas in CSS pixels.
 */
export function describeCanvasLayout(canvas: OffscreenCanvas, cssWidth: number, cssHeight: number): void
{
    Object.assign(canvas, {
        isConnected: true,
        getBoundingClientRect: () => ({
            x: 0, y: 0, left: 0, top: 0, right: cssWidth, bottom: cssHeight, width: cssWidth, height: cssHeight,
        }),
    });
}

/**
 * Replays one event forwarded from the main thread on the target pixi listens to.
 * @param canvas - The renderer's canvas, pixi's event target element.
 * @param e - The event data posted by the main thread.
 */
export function dispatchForwarded(canvas: OffscreenCanvas, e: ForwardedEvent): void
{
    const event = new ForwardedPointerEvent(e.type, e.init);

    if (e.type === 'pointermove')
    {
        fakeDocument.dispatchEvent(event);
    }
    else if (e.type === 'pointerup' || e.type === 'pointercancel')
    {
        // pixi listens for pointerup on the global scope (route pointercancel the same way) and calls it
        // `pointerupoutside` unless the event's target is its canvas. Nothing in a worker bubbles from the
        // canvas to the global scope, so report the original target by hand.
        const up = new ForwardedPointerEvent('pointerup', e.init);
        const target = e.onCanvas ? canvas : globalThis;

        Object.defineProperty(up, 'target', { value: target });
        Object.defineProperty(up, 'composedPath', { value: () => [target] });
        globalThis.dispatchEvent(up);
    }
    else
    {
        canvas.dispatchEvent(event);
    }
}
