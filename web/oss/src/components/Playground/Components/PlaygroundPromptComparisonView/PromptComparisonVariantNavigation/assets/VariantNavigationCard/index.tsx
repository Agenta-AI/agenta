import {memo, useCallback, useMemo} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {
    executionController,
    executionItemController,
    playgroundController,
} from "@agenta/playground"
import {formatCurrency, formatLatency, formatTokenUsage} from "@agenta/shared/utils"
import {DraftTag} from "@agenta/ui/components"
import {useSortable} from "@dnd-kit/sortable"
import {CSS} from "@dnd-kit/utilities"
import {PlusCircle, Timer, X} from "@phosphor-icons/react"
import {Button, Modal, Tag, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"

import Version from "../../../../../assets/Version"

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

    const runnableData = useAtomValue(workflowMolecule.selectors.data(revisionId))
    const removeVariantFromSelection = useSetAtom(playgroundController.actions.removeEntity)
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId))
    const isLocalDraftVariant = isLocalDraftId(revisionId)

    // Map RunnableData fields to display values
    const variantName = runnableData?.name ?? ""
    const variantVersion = runnableData?.version as number | undefined

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
                // Subscribe to chat mode and run status so changes trigger recompute
                get(executionController.selectors.isChatMode)
                const rowIds =
                    (get(executionItemController.selectors.generationRowIds) as string[]) || []
                const results: any[] = []
                get(executionItemController.selectors.runStatusByRowEntity)

                for (const rowId of rowIds) {
                    // Read full result from package store
                    const fullResult = get(
                        executionItemController.selectors.fullResult({rowId, entityId: revisionId}),
                    )
                    if (fullResult?.output) {
                        const output = fullResult.output
                        if (Array.isArray(output)) {
                            // Take the last result for metrics (most recent)
                            const last = output[output.length - 1]
                            if (last) results.push(last)
                        } else {
                            results.push(output)
                        }
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
                                    from {String(variantName).replace(/\s*\(Draft\)$/, "")}
                                    {variantVersion != null ? ` v${variantVersion}` : ""}
                                </Text>
                            </>
                        ) : (
                            // Regular revision: show name and version tag, with Draft tag if dirty
                            <>
                                <Text>{variantName}</Text>
                                {variantVersion != null && <Version revision={variantVersion} />}
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
                    <Tag color="default" variant="filled" className="flex items-center gap-1">
                        <Timer size={14} /> {avgLatency}
                    </Tag>
                </div>
                <div className="flex items-center justify-between">
                    <Text>Average Cost</Text>
                    <Tag color="default" variant="filled" className="flex items-center gap-1">
                        <PlusCircle size={14} /> {avgTokens} / {avgCost}
                    </Tag>
                </div>
            </div>
        </div>
    )
}

export default memo(VariantNavigationCard)
