import {memo} from "react"

import {Skeleton} from "antd"

const FocusDrawerContentSkeleton = () => {
    return (
        <div className="flex flex-col items-center gap-4 p-3">
            <div className="w-full flex items-center gap-2 py-2 justify-between">
                <Skeleton.Node active className="!w-20 !h-6" />
                <Skeleton.Node active className="!w-6 !h-6" />
            </div>
            <Skeleton.Node active className="!w-full !h-[100px]" />
            <Skeleton.Node active className="!w-full !h-[100px]" />
            <Skeleton.Node active className="!w-full !h-[100px]" />

            <div className="w-full flex items-center gap-2 py-2 justify-between">
                <Skeleton.Node active className="!w-24 !h-6" />
                <div className="flex items-center gap-2">
                    <Skeleton.Node active className="!w-16 !h-6" />
                    <Skeleton.Node active className="!w-16 !h-6" />
                    <Skeleton.Node active className="!w-6 !h-6" />
                </div>
            </div>
            <div className="w-full flex items-center gap-2 py-2 justify-between">
                <Skeleton.Node active className="!w-20 !h-6" />
                <Skeleton.Node active className="!w-6 !h-6" />
            </div>
            <Skeleton.Node active className="!w-full !h-[150px]" />
        </div>
    )
}

export default memo(FocusDrawerContentSkeleton)
