import {BROWSER_VIEWPORT} from "@agenta/entities/browser"

/** A client point on the drawn canvas, in the remote viewport's CSS pixels. */
export const toViewportPoint = (
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number,
): {x: number; y: number} => {
    const rect = canvas.getBoundingClientRect()
    const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max)
    return {
        x: Math.round(
            clamp(
                ((clientX - rect.left) / rect.width) * BROWSER_VIEWPORT.width,
                BROWSER_VIEWPORT.width,
            ),
        ),
        y: Math.round(
            clamp(
                ((clientY - rect.top) / rect.height) * BROWSER_VIEWPORT.height,
                BROWSER_VIEWPORT.height,
            ),
        ),
    }
}

const BUTTONS = ["left", "middle", "right"] as const

export const mouseButton = (button: number): (typeof BUTTONS)[number] => BUTTONS[button] ?? "left"

/** Keys a text field cannot carry: these go as key events, everything printable goes as text. */
export const isCommandKey = (event: {
    key: string
    ctrlKey: boolean
    metaKey: boolean
    altKey: boolean
}) =>
    event.key !== "Unidentified" &&
    event.key !== "Process" &&
    (event.key.length > 1 || event.ctrlKey || event.metaKey || event.altKey)
