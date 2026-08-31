import type {ReactNode, Ref} from "react"

/** Fixed counts, not auto-fill: the orphan rule below is nth-child arithmetic and needs a
 * column count CSS can name (container queries are out — oss is still on Tailwind v3). */
const COLUMNS = "grid-cols-2 md:grid-cols-3"

/** A card alone on the last row stretches across it; a row of two or more does not. At three
 * columns the odd-column rule has to be undone, or five cards would stretch the fifth. */
const ORPHAN_SPANS = [
    "[&>*:last-child:nth-child(odd)]:col-span-2",
    "md:[&>*:last-child:nth-child(odd)]:col-span-1",
    "md:[&>*:last-child:nth-child(3n+1)]:col-span-3",
].join(" ")

export interface AttachmentCardGridProps {
    children: ReactNode
    /** Caps the grid and scrolls past it, so a large batch cannot push the input off screen. */
    maxHeight?: number
    /** The scroll container, so a caller can bring a freshly added card into view. */
    ref?: Ref<HTMLDivElement>
    className?: string
}

/**
 * The layout shared by the composer tray and a message's attachments. Same cards, same grid —
 * only the available width differs, which is why a message shows two columns where the composer
 * shows three.
 */
export const AttachmentCardGrid = ({
    children,
    maxHeight,
    ref,
    className,
}: AttachmentCardGridProps) => (
    <div
        ref={ref}
        className={`grid ${COLUMNS} gap-2 ${ORPHAN_SPANS} ${
            maxHeight ? "overflow-y-auto overscroll-y-contain" : ""
        } ${className ?? ""}`}
        style={maxHeight ? {maxHeight} : undefined}
    >
        {children}
    </div>
)

export default AttachmentCardGrid
