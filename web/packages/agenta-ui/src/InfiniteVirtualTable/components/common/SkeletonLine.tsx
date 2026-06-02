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
    const bar = <div className="h-3 rounded bg-neutral-200 animate-pulse" style={{width}} />
    return center ? <div className="flex h-full items-center">{bar}</div> : bar
})

SkeletonLine.displayName = "SkeletonLine"

export default SkeletonLine
