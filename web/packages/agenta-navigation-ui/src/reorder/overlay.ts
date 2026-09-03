/**
 * The chip and the insertion line, as plain DOM appended to `<body>`.
 *
 * Not React: these move every frame, and the whole point of the interaction is that nothing
 * re-renders while a drag is in flight. `colorPrimary` is the app's accent — warm ink in light,
 * brand yellow in dark — not the reference video's macOS blue.
 */
export interface ReorderOverlay {
    moveChip: (x: number, y: number) => void
    moveLine: (left: number, top: number, width: number) => void
    announce: (message: string) => void
    destroy: () => void
}

// font-sans: preflight is off and the chip is a sibling of #__next, so it inherits none of the
// app's typography — without this it renders in the browser's default family, not Inter.
// box-border + a measured width: the chip is the row lifted out, so it keeps the row's width
// rather than shrinking to its own text.
const CHIP_CLASS =
    "fixed left-0 top-0 z-[1100] box-border pointer-events-none truncate rounded-md bg-colorBgElevated px-3 text-sm leading-7 font-sans text-colorText shadow-overlay opacity-90"
const LINE_CLASS =
    "fixed left-0 top-0 z-[1100] h-0.5 pointer-events-none bg-colorPrimary before:absolute before:-left-[3px] before:-top-[2px] before:size-1.5 before:rounded-full before:bg-colorPrimary before:content-['']"

let liveRegion: HTMLElement | null = null

/** One shared live region: a fresh node per drag would not be announced. */
const ensureLiveRegion = (): HTMLElement => {
    if (liveRegion?.isConnected) return liveRegion
    liveRegion = document.createElement("div")
    liveRegion.className = "sr-only"
    liveRegion.setAttribute("aria-live", "polite")
    liveRegion.setAttribute("role", "status")
    document.body.appendChild(liveRegion)
    return liveRegion
}

export const announceReorder = (message: string) => {
    ensureLiveRegion().textContent = message
}

export const createOverlay = (
    label: string,
    size: {width: number; height: number},
): ReorderOverlay => {
    const chip = document.createElement("div")
    chip.className = CHIP_CLASS
    chip.textContent = label
    chip.style.width = `${size.width}px`
    chip.style.height = `${size.height}px`
    const line = document.createElement("div")
    line.className = LINE_CLASS
    document.body.append(chip, line)

    return {
        moveChip: (x, y) => {
            // Centred on the pointer vertically and held at the row's left inset, so a full-width
            // chip tracks the pointer without its far edge swinging around.
            chip.style.transform = `translate3d(${x - 16}px, ${y - size.height / 2}px, 0)`
        },
        moveLine: (left, top, width) => {
            line.style.width = `${width}px`
            line.style.transform = `translate3d(${left}px, ${top}px, 0)`
        },
        announce: announceReorder,
        destroy: () => {
            chip.remove()
            line.remove()
        },
    }
}
