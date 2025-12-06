import {memo} from "react"

const SkeletonLine = memo(({width = "60%"}: {width?: string}) => (
    <div className="h-3 rounded bg-neutral-200/80 animate-pulse" style={{width}} />
))

SkeletonLine.displayName = "SkeletonLine"

export default SkeletonLine
