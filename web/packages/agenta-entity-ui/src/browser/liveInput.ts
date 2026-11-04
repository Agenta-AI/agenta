import type {BrowserViewport} from "./live"

/** A client point on the drawn canvas, in the remote viewport's CSS pixels. */
export const toViewportPoint = (
    canvas: Pick<Element, "getBoundingClientRect">,
    clientX: number,
    clientY: number,
    viewport: BrowserViewport,
): {x: number; y: number} => {
    const rect = canvas.getBoundingClientRect()
    const scale = (offset: number, size: number, max: number) =>
        Math.round(Math.min(Math.max((offset / size) * max, 0), max))
    return {
        x: scale(clientX - rect.left, rect.width, viewport.width),
        y: scale(clientY - rect.top, rect.height, viewport.height),
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
    event.key !== "Dead" &&
    (event.key.length > 1 || event.ctrlKey || event.metaKey || event.altKey)
