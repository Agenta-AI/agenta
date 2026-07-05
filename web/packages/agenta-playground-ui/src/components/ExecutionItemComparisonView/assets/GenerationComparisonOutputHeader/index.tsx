import {memo, useMemo} from "react"

import {isLocalDraftId, getVersionLabel, formatLocalDraftLabel} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {Tag} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

interface GenerationComparisonOutputHeaderProps {
    className?: string
    entityId: string
}

const GenerationComparisonOutputHeader: React.FC<GenerationComparisonOutputHeaderProps> = ({
    className,
    entityId,
}) => {
    const data = useAtomValue(useMemo(() => workflowMolecule.selectors.data(entityId), [entityId]))
    // Comparison columns are labeled by VARIANT. The revision's own `name`
    // is only a fallback for drafts the variants list does not know yet.
    const variantLabel = useAtomValue(
        useMemo(() => workflowMolecule.selectors.variantLabel(entityId), [entityId]),
    )

    const version = data?.version as number | undefined
    const label = isLocalDraftId(entityId) ? formatLocalDraftLabel(null) : getVersionLabel(version)

    return (
        <div
            className={clsx(
                "w-full h-[44px] border-0 border-b border-r border-solid border-colorBorderSecondary px-4 flex gap-2 items-center text-base font-medium bg-[var(--ag-c-FFFFFF)]",
                className,
            )}
        >
            <span>{variantLabel ?? data?.name ?? null}</span>
            <Tag color="default" variant="filled" className="bg-[var(--ag-rgba-051729-06)]">
                {label}
            </Tag>
        </div>
    )
}

export default memo(GenerationComparisonOutputHeader)
