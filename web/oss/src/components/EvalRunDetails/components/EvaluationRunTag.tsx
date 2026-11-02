import {ReactNode} from "react"

import {PushpinFilled} from "@ant-design/icons"
import {Tag} from "antd"
import clsx from "clsx"

import {useChartSeries} from "@/oss/lib/hooks/useChartSeries"

import {getComparisonColor} from "../atoms/compare"

interface EvaluationRunTagProps {
    label: string
    compareIndex?: number
    isBaseRun?: boolean
    closable?: boolean
    closeIcon?: ReactNode
    onClose?: (event: React.MouseEvent<HTMLElement>) => void
    className?: string
}

const EvaluationRunTag = ({
    label,
    compareIndex,
    isBaseRun,
    closable,
    closeIcon,
    onClose,
    className,
}: EvaluationRunTagProps) => {
    const resolvedCompareIndex = compareIndex ?? 0
    const resolvedIsBaseRun = isBaseRun ?? resolvedCompareIndex === 0
    // Solid series color resolved for the active theme (plain hex — see atoms/compare.ts on why
    // solids can't be CSS vars); the tint background still routes through vars.
    const series = useChartSeries()
    const tagColor = series[resolvedCompareIndex] ?? series[0]
    const tagBg = getComparisonColor(resolvedCompareIndex)

    return (
        <Tag
            className={clsx(
                "m-0 inline-flex min-w-0 items-center gap-1 max-w-[240px] px-2 overflow-hidden",
                className,
            )}
            style={{
                backgroundColor: tagBg,
                borderColor: "transparent",
                color: tagColor,
                maxWidth: 240,
            }}
            icon={
                resolvedIsBaseRun ? (
                    <PushpinFilled style={{fontSize: 16, flexShrink: 0}} />
                ) : undefined
            }
            closable={closable}
            closeIcon={closeIcon}
            onClose={onClose}
        >
            <span
                className="min-w-0 flex-1 truncate inline-block max-w-[180px] align-middle"
                title={label}
            >
                {label}
            </span>
        </Tag>
    )
}

export default EvaluationRunTag
