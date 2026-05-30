import React from "react"

import clsx from "clsx"

import {getStringOrJson} from "@/oss/lib/helpers/utils"

interface LabelValuePillProps {
    label: string
    value: string
    className?: string
}

const LabelValuePill = ({label, value, className}: LabelValuePillProps) => {
    return (
        <div
            className={clsx(
                "min-w-[130px] flex cursor-pointer items-stretch rounded-sm border border-colorBorder text-center",
                "[&>div:nth-child(1)]:bg-colorFillQuaternary [&>div:nth-child(1)]:leading-[1.5714285714285714] [&>div:nth-child(1)]:flex-1 [&>div:nth-child(1)]:border-r [&>div:nth-child(1)]:border-colorBorder [&>div:nth-child(1)]:px-[7px] [&>div:nth-child(1)]:max-w-[120px] [&>div:nth-child(1)]:min-w-[120px] [&>div:nth-child(1)]:overflow-hidden [&>div:nth-child(1)]:text-ellipsis [&>div:nth-child(1)]:whitespace-nowrap",
                "[&>div:nth-child(2)]:px-[7px]",
                className,
            )}
        >
            <div>{label}</div>
            <div>{getStringOrJson(value)}</div>
        </div>
    )
}

export default LabelValuePill
