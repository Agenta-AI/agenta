import {memo} from "react"

import {Skeleton} from "antd"
import clsx from "clsx"

const EvalRunHeaderSkeleton = ({className}: {className?: string}) => {
    return (
        <div
            className={clsx([
                "flex items-center justify-between py-2 px-6 sticky top-0 z-[11] bg-white border-0 border-b border-solid border-[#0517290F]",
                className,
            ])}
        >
            <Skeleton.Input active className="!w-[300px] !h-[28px]" />
            <Skeleton.Input active className="!h-[28px]" />
        </div>
    )
}

export default memo(EvalRunHeaderSkeleton)
