import {getStringOrJson} from "@agenta/shared/utils"

import {Pill} from "./Pill"

interface LabelValuePillProps {
    label: string
    value: string
    className?: string
    valueClassName?: string
}

// The metric-cell measurements: a fixed-width label that truncates, so a row of these lines up.
// The dark-mode fills are deliberate: ~4% white is nearly invisible on a dark cell, so the label
// takes a stronger fill and the value half a defined elevated surface. Light is unchanged.
const METRIC_BOX = [
    "min-w-[130px] flex cursor-pointer items-stretch rounded-sm border border-colorBorder text-center",
    "[&>span.value1]:bg-colorFillQuaternary dark:[&>span.value1]:bg-colorFillSecondary [&>span.value1]:leading-[1.5714285714285714] [&>span.value1]:flex-1 [&>span.value1]:border-r [&>span.value1]:border-colorBorder [&>span.value1]:px-[7px] [&>span.value1]:max-w-[120px] [&>span.value1]:min-w-[120px] [&>span.value1]:overflow-hidden [&>span.value1]:text-ellipsis [&>span.value1]:whitespace-nowrap",
    "[&>span.value2]:px-[7px] dark:[&>span.value2]:bg-colorBgElevated",
].join(" ")

/**
 * The evaluator-metric pill. Same structure as `ResultTag` (both go through `Pill`); this one
 * fixes the label width and truncates so a row of metrics aligns.
 */
export const LabelValuePill = ({label, value, className, valueClassName}: LabelValuePillProps) => (
    <Pill
        rootClassName={METRIC_BOX}
        className={className}
        valueClassName={valueClassName}
        value1={label}
        value2={getStringOrJson(value)}
    />
)

export default LabelValuePill
