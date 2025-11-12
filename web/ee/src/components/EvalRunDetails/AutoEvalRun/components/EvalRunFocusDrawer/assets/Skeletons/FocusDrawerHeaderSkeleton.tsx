import {memo} from "react"

import {Skeleton} from "antd"

const FocusDrawerHeaderSkeleton = () => {
    return (
        <div className="flex items-center gap-2">
            <Skeleton.Node active className="!w-6 !h-6" />
            <Skeleton.Node active className="!w-6 !h-6" />
            <Skeleton.Node active className="!w-[100px] !h-6" />
            <Skeleton.Node active className="!w-[250px] !h-6" />
        </div>
    )
}

export default memo(FocusDrawerHeaderSkeleton)
