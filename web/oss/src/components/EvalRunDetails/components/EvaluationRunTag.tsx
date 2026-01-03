import {ReactNode} from "react"

import {PushpinFilled} from "@ant-design/icons"
import {Tag} from "antd"
import clsx from "clsx"

import {getComparisonColor, getComparisonSolidColor} from "../atoms/compare"

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
    const tagColor = getComparisonSolidColor(resolvedCompareIndex)
    const tagBg = getComparisonColor(resolvedCompareIndex)

    return (
        <Tag
            className={clsx(
                "m-0 inline-flex shrink-0 min-w-0 items-center gap-1 max-w-[200px] px-2 overflow-hidden",
                className,
            )}
            style={{
                backgroundColor: tagBg,
                borderColor: "transparent",
                color: tagColor,
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
            <span className="min-w-0 flex-1 truncate">{label}</span>
        </Tag>
    )
}

export default EvaluationRunTag
