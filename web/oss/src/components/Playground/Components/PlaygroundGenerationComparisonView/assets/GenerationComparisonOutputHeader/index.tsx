import {memo, useMemo} from "react"

import {Tag, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import {revisionLabelInfoAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

import {useStyles} from "../styles"

import {GenerationComparisonOutputHeaderProps} from "./types"

const GenerationComparisonOutputHeader: React.FC<GenerationComparisonOutputHeaderProps> = ({
    className,
    variantId,
}) => {
    // Use the entity-level revision label API (handles both regular revisions and local drafts)
    const labelInfo = useAtomValue(
        useMemo(() => revisionLabelInfoAtomFamily(variantId), [variantId]),
    )

    const classes = useStyles()

    return (
        <div className={clsx(classes.title, className)}>
            <Typography>{labelInfo.variantName}</Typography>
            <Tag color="default" variant="filled" className="bg-[rgba(5,23,41,0.06)]">
                {labelInfo.label}
            </Tag>
        </div>
    )
}

export default memo(GenerationComparisonOutputHeader)
