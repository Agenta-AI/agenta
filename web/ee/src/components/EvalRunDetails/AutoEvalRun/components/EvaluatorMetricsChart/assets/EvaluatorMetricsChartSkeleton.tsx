import {memo} from "react"
import clsx from "clsx"
import {Skeleton} from "antd"

const EvaluatorMetricsChartSkeleton = ({className}: {className?: string}) => {
    return (
        <div className={clsx("w-full border border-solid border-[#0517290F] rounded", className)}>
            <div className="flex items-center justify-between h-[60px] px-3 py-2 gap-1 border-0 border-b border-solid border-[#EAEFF5]">
                <Skeleton.Input active className="!w-[140px] !h-[20px]" />
                <Skeleton.Input active className="!w-[180px] !h-[24px]" />
            </div>
            <div className="p-2 w-full h-[calc(100%-60px)]">
                <Skeleton.Node active className="!w-full !h-[300px]" />
            </div>
        </div>
    )
}

export default memo(EvaluatorMetricsChartSkeleton)
