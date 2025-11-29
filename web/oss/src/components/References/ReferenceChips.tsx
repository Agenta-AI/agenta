import {memo, useMemo} from "react"

import {Tag, type TagProps} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"

import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"

import {variantReferenceQueryAtomFamily, testsetReferenceQueryAtomFamily} from "./EvalRunReferences"

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

export const VariantReferenceChip = memo(({variantId}: {variantId: string | null | undefined}) => {
    const queryAtom = useMemo(() => variantReferenceQueryAtomFamily(variantId ?? null), [variantId])
    const query = useAtomValue(queryAtom)

    if (!variantId) {
        return null
    }

    const label =
        query.data?.name ?? query.data?.slug ?? query.data?.id ?? variantId ?? "Unknown variant"

    return (
        <ReferenceChip
            label={label}
            copyValue={variantId}
            tone="variant"
            loading={query.isPending || query.isFetching}
        />
    )
})

export const TestsetReferenceChip = memo(({testsetId}: {testsetId: string}) => {
    const queryAtom = useMemo(() => testsetReferenceQueryAtomFamily(testsetId), [testsetId])
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
})

export const TestsetChipList = memo(({ids}: {ids: string[]}) => {
    if (!ids.length) {
        return null
    }

    return (
        <div className="flex flex-wrap items-center gap-2">
            {ids.map((id) => (
                <TestsetReferenceChip key={id} testsetId={id} />
            ))}
        </div>
    )
})
