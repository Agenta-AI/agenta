import {memo} from "react"
import {Skeleton} from "antd"
import clsx from "clsx"

const EvalRunScoreTableSkeleton = ({className}: {className?: string}) => {
    return (
        <div className={clsx("w-full border border-solid border-[#0517290F] rounded", className)}>
            <div className="flex flex-col h-[60px] justify-center px-3 py-2 gap-1 border-0 border-b border-solid border-[#EAEFF5]">
                <Skeleton.Input active className="!w-[220px] !h-[20px]" />
                <Skeleton.Input active className="!w-[320px] !h-[14px]" />
            </div>
            <div className="p-2 w-full h-[calc(100%-60px)] flex gap-2 shrink-0">
                <Skeleton.Node active className="!w-full !h-[420px]" />
                <Skeleton.Node active className="!w-full !h-[420px]" />
            </div>
        </div>
    )
}

export default memo(EvalRunScoreTableSkeleton)
