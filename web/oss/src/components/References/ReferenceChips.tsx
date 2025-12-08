import {memo, useMemo} from "react"

import {Tag, type TagProps} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"

import {variantConfigAtomFamily, previewTestsetReferenceAtomFamily} from "./atoms/entityReferences"

type ChipTone = "variant" | "testset"

const CHIP_STYLES: Record<ChipTone, string> = {
    variant: "!border-[#E9D7FE] !bg-[#F4EBFF] !text-[#7839EE]",
    testset: "!border-[#FCE7F6] !bg-[#FDF2FA] !text-[#C11574]",
}

interface ReferenceChipProps extends TagProps {
    label: string
    copyValue?: string
    tone?: ChipTone
    loading?: boolean
}

const ReferenceChip = ({
    label,
    copyValue,
    tone = "variant",
    loading = false,
    className,
    ...props
}: ReferenceChipProps) => {
    const chip = (
        <Tag
            bordered
            className={clsx(
                "inline-flex items-center rounded-full px-3 py-[6px] font-medium",
                CHIP_STYLES[tone],
                loading ? "cursor-wait" : "cursor-copy",
                className,
            )}
            {...props}
        >
            {loading ? "Loading…" : label}
        </Tag>
    )

    if (loading || !copyValue) {
        return chip
    }

    return (
        <TooltipWithCopyAction title="Copy identifier" copyText={copyValue}>
            {chip}
        </TooltipWithCopyAction>
    )
}

/**
 * Generic variant reference chip.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const VariantReferenceChip = memo(
    ({
        revisionId,
        projectId,
    }: {
        revisionId: string | null | undefined
        projectId: string | null
    }) => {
        const queryAtom = useMemo(
            () => variantConfigAtomFamily({projectId, revisionId}),
            [projectId, revisionId],
        )
        const query = useAtomValue(queryAtom)

        if (!revisionId) {
            return null
        }

        const label =
            query.data?.variantName ?? query.data?.revisionId ?? revisionId ?? "Unknown variant"

        return (
            <ReferenceChip
                label={label}
                copyValue={revisionId}
                tone="variant"
                loading={query.isPending || query.isFetching}
            />
        )
    },
)

/**
 * Generic testset reference chip.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const TestsetReferenceChip = memo(
    ({testsetId, projectId}: {testsetId: string; projectId: string | null}) => {
        const queryAtom = useMemo(
            () => previewTestsetReferenceAtomFamily({projectId, testsetId}),
            [projectId, testsetId],
        )
        const query = useAtomValue(queryAtom)

        const label = query.data?.name ?? query.data?.id ?? testsetId

        return (
            <ReferenceChip
                label={label}
                copyValue={testsetId}
                tone="testset"
                loading={query.isPending || query.isFetching}
            />
        )
    },
)

/**
 * Generic testset chip list.
 * Requires projectId to be passed explicitly for reusability across contexts.
 */
export const TestsetChipList = memo(
    ({ids, projectId}: {ids: string[]; projectId: string | null}) => {
        if (!ids.length) {
            return null
        }

        return (
            <div className="flex flex-wrap items-center gap-2">
                {ids.map((id) => (
                    <TestsetReferenceChip key={id} testsetId={id} projectId={projectId} />
                ))}
            </div>
        )
    },
)
