import {memo, useMemo} from "react"

import {useSortable} from "@dnd-kit/sortable"
import {CSS} from "@dnd-kit/utilities"
import {PlusCircle, Timer, X} from "@phosphor-icons/react"
import {Button, Tag, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {generationLogicalTurnIdsAtom as compatRowIdsAtom} from "@/oss/state/generation/compat"
import {logicalTurnIndexAtom, runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"

import Version from "../../../../../assets/Version"
import {
    removeVariantFromSelectionMutationAtom,
    variantByRevisionIdAtomFamily,
    generationResultAtomFamily,
    appChatModeAtom,
} from "../../../../../state/atoms"

import {useStyles} from "./styles"
import type {VariantNavigationCardProps} from "./types"

const {Text} = Typography

const VariantNavigationCard = ({
    revisionId,
    id,
    className,
    handleScrollClick,
}: VariantNavigationCardProps) => {
    const classes = useStyles()

    // Read only the specific variant by revisionId
    const variant = useAtomValue(variantByRevisionIdAtomFamily(revisionId)) as any
    const removeVariantFromSelection = useSetAtom(removeVariantFromSelectionMutationAtom)

    // Aggregate visible trace results for this revision across current rows
    const metricsAtom = useMemo(
        () =>
            atom((get) => {
                const isChat = Boolean(get(appChatModeAtom))
                const rowIds = (get(compatRowIdsAtom) as string[]) || []
                const results: any[] = []
                // Read run status map up-front so changes trigger recompute even if other deps don't
                const statusMap = get(runStatusByRowRevisionAtom) || {}
                for (const rowId of rowIds) {
                    if (isChat) {
                        // Map logical turn id to this revision's session turn id
                        const sessionTurnId = (get(logicalTurnIndexAtom)?.[rowId]?.[revisionId] ||
                            "") as string
                        if (!sessionTurnId) {
                            continue
                        }
                        const key = `${sessionTurnId}:${revisionId}`
                        const {resultHash} = (statusMap as any)[key] || {}
                        const res = getResponseLazy(resultHash)
                        if (res) results.push(res)
                        continue
                    }

                    // Completion: use canonical selector
                    const {resultHash} = get(
                        generationResultAtomFamily({variantId: revisionId, rowId}),
                    )
                    const res = getResponseLazy(resultHash)
                    if (res) {
                        results.push(res)
                        continue
                    }

                    // Last-resort: use run-status map resultHash
                    const key = `${rowId}:${revisionId}`
                    const hash = (statusMap as any)[key]?.resultHash
                    if (hash) {
                        const rs = getResponseLazy(hash)
                        if (rs) results.push(rs)
                    }
                }

                // Reduce metrics across results (prefer acc, fallback to unit)
                let durationTotal = 0
                let costsTotal = 0
                let tokensTotal = 0
                let count = 0

                for (const r of results) {
                    const metrics =
                        (r as any)?.response?.tree?.nodes?.[0]?.metrics?.acc ||
                        (r as any)?.response?.tree?.nodes?.[0]?.metrics?.unit
                    if (!metrics) continue
                    durationTotal += Number(metrics?.duration?.total || 0)
                    costsTotal += Number(metrics?.costs?.total || 0)
                    tokensTotal += Number(metrics?.tokens?.total || 0)
                    count += 1
                }

                if (count === 0) {
                    return {
                        avgLatency: "-",
                        avgTokens: "-",
                        avgCost: "-",
                    }
                }

                const summary = {
                    avgLatency: formatLatency(durationTotal / count / 1000),
                    avgTokens: formatTokenUsage(tokensTotal / count),
                    avgCost: formatCurrency(costsTotal / count),
                }
                return summary
            }),
        [revisionId],
    )
    const {avgLatency, avgTokens, avgCost} = useAtomValue(metricsAtom)
    const {attributes, listeners, setNodeRef, transform, transition, isDragging, active} =
        useSortable({id})
    const style = useMemo(
        () => ({
            transform: CSS.Transform.toString(transform),
            transition,
        }),
        [transform, transition],
    )

    return (
        <div
            ref={setNodeRef}
            style={style}
            {...attributes}
            {...listeners}
            onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                handleScrollClick()
            }}
            className={clsx(
                "cursor-move",
                {
                    "z-[10]": isDragging,
                },
                className,
            )}
        >
            <div
                className={clsx(
                    "p-2 rounded-lg w-full flex flex-col gap-3",
                    "translate-x-0 translate-y-0 skew-x-0 skew-y-0 rotate-0",
                    "transition-all duration-200 ease-in-out",
                    "opacity-100 *:!select-none",
                    classes.card,
                    {
                        "shadow-xl [&_>_div]:scale-[1.01]": isDragging,
                        "opacity-50": active && !isDragging,
                    },
                )}
            >
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
                        <Text>{variant?.variantName}</Text>
                        <Version revision={variant?.revision as number} />
                    </div>
                    <Button
                        type="text"
                        className="relative z-[2]"
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()

                            // Use atom-based mutation for better performance and consistency
                            removeVariantFromSelection(revisionId)
                        }}
                    >
                        <X size={14} />
                    </Button>
                </div>
                <div className="flex items-center justify-between">
                    <Text>Average Latency</Text>
                    <Tag color="default" bordered={false} className="flex items-center gap-1">
                        <Timer size={14} /> {avgLatency}
                    </Tag>
                </div>
                <div className="flex items-center justify-between">
                    <Text>Average Cost</Text>
                    <Tag color="default" bordered={false} className="flex items-center gap-1">
                        <PlusCircle size={14} /> {avgTokens} / {avgCost}
                    </Tag>
                </div>
            </div>
        </div>
    )
}

export default memo(VariantNavigationCard)
