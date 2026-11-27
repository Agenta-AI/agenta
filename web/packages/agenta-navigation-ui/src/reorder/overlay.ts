/**
 * The chip and the insertion line, as plain DOM appended to `<body>`.
 *
 * Not React: these move every frame, and the whole point of the interaction is that nothing
 * re-renders while a drag is in flight. The line is ink (`foreground`), never brand yellow.
 */
export interface ReorderOverlay {
    moveChip: (x: number, y: number) => void
    moveLine: (left: number, top: number, width: number) => void
    announce: (message: string) => void
    destroy: () => void
}

// The dragged row, lifted: sized by its own padding; `leading-none` keeps the row's 28px line out.
const CHIP_CLASS =
    "fixed left-0 top-0 z-[var(--z-tooltip)] box-border pointer-events-none flex items-center rounded-md bg-background px-2 py-1.5 leading-none text-foreground shadow-raised opacity-90"

/** The type the chip lifts off the row it came from. Line-height is deliberately NOT among them. */
const TYPE_PROPS = [
    "fontFamily",
    "fontSize",
    "fontWeight",
    "fontStyle",
    "letterSpacing",
    "textTransform",
] as const
const LINE_CLASS =
    "fixed left-0 top-0 z-[var(--z-tooltip)] h-px pointer-events-none bg-foreground before:absolute before:-left-[3px] before:-top-[2.5px] before:size-1.5 before:rounded-round before:bg-foreground before:content-['']"

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

/**
 * The chip is the dragged row, lifted out — same width, same height, same type.
 *
 * The type is COPIED from the row rather than set in classes. Next's font variable is declared on
 * the app's own root element, and the chip is a sibling of `#__next`, so `font-sans` there
 * resolves to nothing and the chip fell back to the browser's default serif.
 */
export const createOverlay = (label: string, source: HTMLElement): ReorderOverlay => {
    const size = source.getBoundingClientRect()
    const rowType = getComputedStyle(source)
    const chip = document.createElement("div")
    chip.className = CHIP_CLASS
    const text = document.createElement("span")
    text.className = "min-w-0 truncate"
    text.textContent = label
    chip.appendChild(text)
    for (const prop of TYPE_PROPS) chip.style[prop] = rowType[prop]
    // Width only: the row's width is what the user asked to keep, the row's height is not.
    chip.style.width = `${size.width}px`
    const line = document.createElement("div")
    line.className = LINE_CLASS
    document.body.append(chip, line)
    // Measured ONCE, after append: reading it per frame would put a layout back in the drag loop.
    const halfHeight = chip.offsetHeight / 2

    return {
        moveChip: (_x, y) => {
            // Vertical only, pinned to the row's left edge. A row-width chip that also tracked
            // the pointer horizontally hung out of the rail and over the page.
            chip.style.transform = `translate3d(${size.left}px, ${y - halfHeight}px, 0)`
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
