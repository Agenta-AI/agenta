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

const CHIP_CLASS =
    "fixed left-0 top-0 z-[1100] pointer-events-none max-w-[220px] truncate rounded-md bg-colorBgElevated px-3 py-1 text-sm text-colorText shadow-overlay opacity-90"
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

export const createOverlay = (label: string): ReorderOverlay => {
    const chip = document.createElement("div")
    chip.className = CHIP_CLASS
    chip.textContent = label
    const line = document.createElement("div")
    line.className = LINE_CLASS
    document.body.append(chip, line)

    return {
        moveChip: (x, y) => {
            chip.style.transform = `translate3d(${x + 12}px, ${y - 12}px, 0)`
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
