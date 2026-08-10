import {memo} from "react"

interface SkeletonLineProps {
    width?: string
    /**
     * Vertically center the bar within the table cell (cells are taller than the
     * 12px bar). Defaults to true so a bare `<SkeletonLine />` lines up with real
     * cell content, which wraps in `h-full flex items-center`. Pass `false` when
     * stacking multiple lines inside your own centered container.
     */
    center?: boolean
}

const SkeletonLine = memo(({width = "60%", center = true}: SkeletonLineProps) => {
    // Palette token (not a fixed grey) so the shimmer reads correctly in dark mode too.
    // `h-4` gives the bar real content weight (a thin bar looks lost in a data row).
    const bar = <div className="h-4 rounded bg-colorFillSecondary animate-pulse" style={{width}} />
    // `min-h-6` floors the cell height. These tables auto-measure row height from content, and a
    // skeleton cell has no text — without a floor the `h-full` wrapper collapses and the row
    // shrinks to the bar. 24px keeps the skeleton row at a real data-row height (~40px with padding).
    return center ? <div className="flex h-full min-h-6 items-center">{bar}</div> : bar
})

SkeletonLine.displayName = "SkeletonLine"

export default SkeletonLine
