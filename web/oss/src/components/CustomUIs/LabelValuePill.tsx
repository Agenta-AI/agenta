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
                // Label tab: a faint fill in light reads fine on white, but ~4%
                // white is nearly invisible on a dark cell — bump the fill in dark
                // so the label/value split stays legible. Light is unchanged.
                "[&>div:nth-child(1)]:bg-colorFillQuaternary dark:[&>div:nth-child(1)]:bg-colorFillSecondary [&>div:nth-child(1)]:leading-[1.5714285714285714] [&>div:nth-child(1)]:flex-1 [&>div:nth-child(1)]:border-r [&>div:nth-child(1)]:border-colorBorder [&>div:nth-child(1)]:px-[7px] [&>div:nth-child(1)]:max-w-[120px] [&>div:nth-child(1)]:min-w-[120px] [&>div:nth-child(1)]:overflow-hidden [&>div:nth-child(1)]:text-ellipsis [&>div:nth-child(1)]:whitespace-nowrap",
                // Value half: transparent over the white cell in light reads
                // clean, but on a dark cell it looks empty next to the filled
                // label — give it a defined elevated surface in dark only.
                "[&>div:nth-child(2)]:px-[7px] dark:[&>div:nth-child(2)]:bg-colorBgElevated",
                className,
            )}
        >
            <div>{label}</div>
            <div>{getStringOrJson(value)}</div>
        </div>
    )
}

export default LabelValuePill
