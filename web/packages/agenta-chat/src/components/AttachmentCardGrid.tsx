import type {ReactNode, Ref} from "react"

/**
 * Wrapping flex rather than a grid: a short final row grows to fill the width, so two cards left
 * over split the row between them instead of sitting in their columns beside a hole. A grid can
 * only stretch a lone orphan, and only through nth-child arithmetic that has to know the column
 * count.
 *
 * The basis is a whole column minus its share of the gap, so a full row still fits exactly two
 * cards on a phone and three from `md` up.
 */
const COLUMNS = [
    "[&>*]:min-w-0 [&>*]:grow [&>*]:basis-[calc(50%-0.1875rem)]",
    "md:[&>*]:basis-[calc(33.333%-0.25rem)]",
].join(" ")

export interface AttachmentCardGridProps {
    children: ReactNode
    /** Caps the list and scrolls past it, so a large batch cannot push the input off screen. */
    maxHeight?: number
    /** The scroll container, so a caller can bring a freshly added card into view. */
    ref?: Ref<HTMLDivElement>
    className?: string
}

/**
 * The layout shared by the composer tray and a message's attachments. Same cards, same rules —
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
        className={`flex flex-wrap gap-1.5 ${COLUMNS} ${
            maxHeight ? "overflow-y-auto overscroll-y-contain" : ""
        } ${className ?? ""}`}
        style={maxHeight ? {maxHeight} : undefined}
    >
        {children}
    </div>
)

export default AttachmentCardGrid
