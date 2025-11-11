import {memo} from "react"

import {Skeleton} from "antd"

const FocusDrawerSidePanelSkeleton = () => {
    return (
        <div className="flex flex-col items-center gap-2 p-3">
            {Array.from({length: 8}).map((_, idx) => (
                <Skeleton.Node active key={idx} className="!w-full !h-5" />
            ))}
        </div>
    )
}

export default memo(FocusDrawerSidePanelSkeleton)
