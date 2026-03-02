import {memo} from "react"

import {Skeleton} from "antd"

const PromptConfigCardSkeleton = () => (
    <div className="w-full">
        <div className="w-full flex items-center justify-between px-4 py-3 bg-gray-50">
            <Skeleton.Button active size="small" style={{width: 180, height: 22}} />
            <Skeleton.Button active size="small" style={{width: 100, height: 28}} />
        </div>
        <div className="w-full px-4 py-3 flex flex-col gap-4">
            <Skeleton.Input active style={{width: "100%", height: 120}} />
            <Skeleton.Input active style={{width: "100%", height: 120}} />
        </div>
    </div>
)

export default memo(PromptConfigCardSkeleton)
