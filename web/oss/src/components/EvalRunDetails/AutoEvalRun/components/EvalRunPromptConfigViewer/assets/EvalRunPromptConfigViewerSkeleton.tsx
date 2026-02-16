import {memo} from "react"

import {Skeleton} from "antd"
import clsx from "clsx"

const EvalRunPromptConfigViewerSkeleton = ({className}: {className?: string}) => {
    return (
        <div className={clsx(["w-full flex px-6", className])}>
            <div className="w-full border border-solid border-[#0517290F] rounded overflow-hidden">
                <div className="w-full flex items-center justify-between border-0 border-b border-solid border-[#0517290F] px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Skeleton.Button active size="small" style={{width: 90, height: 22}} />
                        <Skeleton.Button active size="small" style={{width: 90, height: 22}} />
                    </div>
                    <Skeleton.Button active size="small" style={{width: 22, height: 22}} />
                </div>

                <PromptConfigCardSkeleton />
            </div>
        </div>
    )
}

export default memo(EvalRunPromptConfigViewerSkeleton)

export const PromptConfigCardSkeleton = memo(() => {
    return (
        <div className="w-full">
            {/* Header */}
            <div className="w-full flex items-center justify-between px-4 py-3 bg-gray-50">
                <Skeleton.Button active size="small" style={{width: 180, height: 22}} />
                <Skeleton.Button active size="small" style={{width: 100, height: 28}} />
            </div>

            {/* Prompt section */}
            <div className="w-full px-4 py-3 flex flex-col gap-4">
                <Skeleton.Input active style={{width: "100%", height: 120}} />
                <Skeleton.Input active style={{width: "100%", height: 120}} />
            </div>
        </div>
    )
})
