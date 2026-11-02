import type {ReactNode, Ref} from "react"

export interface AttachmentCardGridProps {
    children: ReactNode
    /** Caps the list and scrolls past it, so a large batch cannot push the input off screen. */
    maxHeight?: number
    /** The scroll container, so a caller can bring a freshly added card into view. */
    ref?: Ref<HTMLDivElement>
    className?: string
}

/** Square attachment tiles in rows that wrap. */
export const AttachmentCardGrid = ({
    children,
    maxHeight,
    ref,
    className,
}: AttachmentCardGridProps) => (
    <div
        ref={ref}
        className={`flex flex-wrap gap-2 ${
            maxHeight ? "overflow-y-auto overscroll-y-contain" : ""
        } ${className ?? ""}`}
        style={maxHeight ? {maxHeight} : undefined}
    >
        {children}
    </div>
)

export default AttachmentCardGrid
