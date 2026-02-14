import {memo, useMemo} from "react"

import {legacyAppRevisionMolecule} from "@agenta/entities/legacyAppRevision"
import {isLocalDraftId, getVersionLabel, formatLocalDraftLabel} from "@agenta/entities/shared"
import {Tag, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

interface GenerationComparisonOutputHeaderProps {
    className?: string
    entityId: string
}

const asRecord = (value: unknown): Record<string, unknown> | null => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null
    return value as Record<string, unknown>
}

const GenerationComparisonOutputHeader: React.FC<GenerationComparisonOutputHeaderProps> = ({
    className,
    entityId,
}) => {
    const data = useAtomValue(
        useMemo(() => legacyAppRevisionMolecule.atoms.data(entityId), [entityId]),
    )

    const sourceRevisionRaw = asRecord(data)?._sourceRevision
    const sourceRevision =
        typeof sourceRevisionRaw === "number"
            ? sourceRevisionRaw
            : typeof sourceRevisionRaw === "string"
              ? Number(sourceRevisionRaw)
              : null
    const label = isLocalDraftId(entityId)
        ? formatLocalDraftLabel(sourceRevision)
        : getVersionLabel(data?.revision)

    return (
        <div
            className={clsx(
                "w-full h-[44px] border-0 border-b border-r border-solid border-colorBorderSecondary px-4 flex gap-2 items-center text-base font-medium bg-white",
                className,
            )}
        >
            <Typography>{data?.variantName ?? null}</Typography>
            <Tag color="default" variant="filled" className="bg-[rgba(5,23,41,0.06)]">
                {label}
            </Tag>
        </div>
    )
}

export default memo(GenerationComparisonOutputHeader)
