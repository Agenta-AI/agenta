import {memo, useCallback, useMemo} from "react"

import {DraftTag} from "@agenta/ui/components"
import {useSortable} from "@dnd-kit/sortable"
import {CSS} from "@dnd-kit/utilities"
import {PlusCircle, Timer, X} from "@phosphor-icons/react"
import {Button, Modal, Tag, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"

import {removeVariantFromSelectionMutationAtom} from "@/oss/components/Playground/state/atoms/variantCrudMutations"
import {formatCurrency, formatLatency, formatTokenUsage} from "@/oss/lib/helpers/formatters"
import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {generationLogicalTurnIdsAtom as compatRowIdsAtom} from "@/oss/state/generation/compat"
import {runStatusByRowRevisionAtom} from "@/oss/state/generation/entities"
import {isLocalDraft, revisionIsDirtyAtomFamily} from "@/oss/state/newPlayground/legacyEntityBridge"

import Version from "../../../../../assets/Version"
import {
    moleculeBackedVariantAtomFamily,
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

    // Use molecule-backed variant for single source of truth
    const variant = useAtomValue(moleculeBackedVariantAtomFamily(revisionId)) as any
    const removeVariantFromSelection = useSetAtom(removeVariantFromSelectionMutationAtom)
    const isDirty = useAtomValue(revisionIsDirtyAtomFamily(revisionId))
    const isLocalDraftVariant = isLocalDraft(revisionId)

    // Handle close with confirmation only if there are actual committable changes
    // A local draft without changes (isDirty === false) should close without confirmation
    const handleClose = useCallback(() => {
        if (isDirty) {
            Modal.confirm({
                title: "Discard unsaved changes?",
                content: isLocalDraftVariant
                    ? "This draft has uncommitted changes. Closing it will discard all changes."
                    : "You have unsaved changes in this variant. Closing it will discard these changes.",
                okText: "Discard",
                okButtonProps: {danger: true},
                cancelText: "Cancel",
                onOk: () => {
                    removeVariantFromSelection(revisionId)
                },
            })
        } else {
            removeVariantFromSelection(revisionId)
        }
    }, [isDirty, isLocalDraftVariant, removeVariantFromSelection, revisionId])

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
                    // Try run-status map first (works for both chat and completion, including local drafts)
                    const key = `${rowId}:${revisionId}`
                    const statusEntry = (statusMap as any)[key]

                    if (statusEntry?.resultHash) {
                        const res = getResponseLazy(statusEntry.resultHash)
                        if (res) {
                            results.push(res)
                            continue
                        }
                    }

                    if (isChat) {
                        // Chat mode already tried via statusMap above
                        continue
                    }

                    // Completion: use canonical selector as fallback
                    const {resultHash} = get(
                        generationResultAtomFamily({variantId: revisionId, rowId}),
                    )
                    const res = getResponseLazy(resultHash)
                    if (res) {
                        results.push(res)
                        continue
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
                        {isLocalDraftVariant ? (
                            // Local draft: show Draft tag then source revision info
                            <>
                                <DraftTag />
                                <Text className="text-gray-500">
                                    from{" "}
                                    {String(variant?.variantName ?? "").replace(
                                        /\s*\(Draft\)$/,
                                        "",
                                    )}{" "}
                                    v{variant?.revision}
                                </Text>
                            </>
                        ) : (
                            // Regular revision: show name and version tag, with Draft tag if dirty
                            <>
                                <Text>{variant?.variantName}</Text>
                                <Version revision={variant?.revision as number} />
                                {isDirty && <DraftTag />}
                            </>
                        )}
                    </div>
                    <Button
                        type="text"
                        className="relative z-[2]"
                        onPointerDown={(e) => {
                            // Prevent drag activation when clicking the close button
                            e.stopPropagation()
                        }}
                        onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleClose()
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
