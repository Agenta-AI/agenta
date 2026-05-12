/**
 * SessionNavigation
 *
 * Footer bar for the annotation session.
 *
 * Left:   scenario selector (N/Total format) | trace/testcase ID with copy button
 * Right:  "Hide marked complete" toggle | "Auto next" toggle |
 *         Prev button | Next button | Mark completed button
 */

import {useCallback, useMemo} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {useModifierKey} from "@agenta/shared/hooks"
import {message} from "@agenta/ui/app-message"
import {CopyTooltip} from "@agenta/ui/copy-tooltip"
import {ArrowSquareOut, CaretLeft, CaretRight, Copy, Plus} from "@phosphor-icons/react"
import {Button, Select, Switch, Tag, Tooltip, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useAnnotationNavigation} from "../../context"

import {getAddToTestsetDisabledReason} from "./assets/utils"

// ============================================================================
// HELPERS
// ============================================================================

/** Truncates an ID to "first8...last4" format for display */
function truncateId(id: string): string {
    if (id.length <= 14) return id
    return `${id.slice(0, 5)}...${id.slice(-5)}`
}

// ============================================================================
// TYPES
// ============================================================================

interface SessionNavigationProps {
    scenarioId: string
    queueId: string
    onCompleted?: (scenarioId: string) => void
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const SessionNavigation = ({scenarioId, queueId, onCompleted}: SessionNavigationProps) => {
    const navigation = useAnnotationNavigation()
    const modifierKey = useModifierKey()

    const hasNext = useAtomValue(annotationSessionController.selectors.hasNext())
    const hasPrev = useAtomValue(annotationSessionController.selectors.hasPrev())
    const scenarioIds = useAtomValue(annotationSessionController.selectors.focusScenarioIds())
    const hideCompletedInFocus = useAtomValue(
        annotationSessionController.selectors.hideCompletedInFocus(),
    )
    const focusAutoNext = useAtomValue(annotationSessionController.selectors.focusAutoNext())

    const currentScenarioId = useAtomValue(
        annotationSessionController.selectors.currentScenarioId(),
    )
    const currentVisibleIndex = currentScenarioId ? scenarioIds.indexOf(currentScenarioId) : -1
    const totalScenarios = useAtomValue(annotationSessionController.selectors.scenarioIds()).length

    const queueKind = useAtomValue(annotationSessionController.selectors.queueKind())
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(currentScenarioId ?? ""),
    )
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(currentScenarioId ?? ""),
    )
    const isTrace = queueKind === "traces" && !!traceRef.traceId
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(isTrace ? traceRef.traceId : null))

    // Mark-complete button state
    const isSubmitting = useAtomValue(annotationFormController.selectors.isSubmitting(scenarioId))
    const hasFilledMetrics = useAtomValue(
        annotationFormController.selectors.hasFilledMetrics(scenarioId),
    )
    const hasPendingChanges = useAtomValue(
        annotationFormController.selectors.hasPendingChanges(scenarioId),
    )
    const isAddToTestsetExporting = useAtomValue(
        annotationSessionController.selectors.isAddToTestsetExporting(),
    )
    const isCompleted = useAtomValue(annotationSessionController.selectors.isCurrentCompleted())
    const submitAnnotations = useSetAtom(annotationFormController.actions.submitAnnotations)

    const navigateNext = useSetAtom(annotationSessionController.actions.navigateNext)
    const navigatePrev = useSetAtom(annotationSessionController.actions.navigatePrev)
    const navigateToIndex = useSetAtom(annotationSessionController.actions.navigateToIndex)
    const setHideCompletedInFocus = useSetAtom(
        annotationSessionController.actions.setHideCompletedInFocus,
    )
    const setFocusAutoNext = useSetAtom(annotationSessionController.actions.setFocusAutoNext)
    const openAddToTestsetModal = useSetAtom(
        annotationSessionController.actions.openAddToTestsetModal,
    )

    const handleSelect = useCallback(
        (value: number) => {
            navigateToIndex(value)
        },
        [navigateToIndex],
    )

    const handleMarkComplete = useCallback(async () => {
        try {
            await submitAnnotations({
                scenarioId,
                queueId,
                markComplete: !isCompleted,
            })

            if (isCompleted) {
                message.success("Updated feedback")
                return
            }

            onCompleted?.(scenarioId)
        } catch (err) {
            message.error((err as Error).message || "Failed to submit annotations")
        }
    }, [submitAnnotations, scenarioId, queueId, isCompleted, onCompleted])

    const handleViewTrace = useCallback(() => {
        if (traceRef.traceId && navigation.openTraceDetail) {
            navigation.openTraceDetail({
                traceId: traceRef.traceId,
                spanId: rootSpan?.span_id ?? null,
            })
        }
    }, [traceRef.traceId, rootSpan?.span_id, navigation])

    const handleAddToTestset = useCallback(() => {
        if (!scenarioId) return
        openAddToTestsetModal({scope: "single", scenarioIds: [scenarioId]})
    }, [openAddToTestsetModal, scenarioId])

    const displayId = isTrace ? traceRef.traceId : testcaseRef.testcaseId

    const options = useMemo(
        () =>
            scenarioIds.map((_, index) => ({
                value: index,
                label: `${index + 1} / ${totalScenarios}`,
            })),
        [scenarioIds, totalScenarios],
    )
    const addToTestsetDisabledReason = useMemo(
        () =>
            getAddToTestsetDisabledReason({
                scenarioId,
                isCompleted,
                isSubmitting,
                hasPendingChanges,
            }),
        [scenarioId, isCompleted, isSubmitting, hasPendingChanges],
    )

    return (
        <div className="w-full flex items-center justify-between gap-4">
            {/* Left: scenario selector + ID */}
            <div className="flex items-center gap-2 shrink-0">
                <Select
                    value={
                        scenarioIds.length > 0 && currentVisibleIndex >= 0
                            ? currentVisibleIndex
                            : undefined
                    }
                    onChange={handleSelect}
                    options={options}
                    size="small"
                    className="min-w-[100px]"
                    popupMatchSelectWidth={false}
                    disabled={scenarioIds.length === 0}
                />

                {displayId && (
                    <CopyTooltip
                        copyText={displayId}
                        title={isTrace ? "Copy trace ID" : "Copy testcase ID"}
                    >
                        <Tag className="!font-mono bg-default flex items-center gap-2">
                            {truncateId(displayId)} <Copy size={12} />
                        </Tag>
                    </CopyTooltip>
                )}

                {isTrace && navigation.openTraceDetail && (
                    <Button
                        size="small"
                        type="text"
                        icon={<ArrowSquareOut size={13} />}
                        onClick={handleViewTrace}
                        className="!text-[#758391]"
                    />
                )}
            </div>

            {/* Right: switches + navigation + mark complete */}
            <div className="flex items-center gap-4 shrink-0">
                <label className="inline-flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
                    <Switch
                        size="small"
                        checked={hideCompletedInFocus}
                        onChange={setHideCompletedInFocus}
                    />
                    <Typography.Text type="secondary" className="text-xs">
                        Hide marked complete
                    </Typography.Text>
                </label>

                <label className="inline-flex items-center gap-2 cursor-pointer select-none whitespace-nowrap">
                    <Switch size="small" checked={focusAutoNext} onChange={setFocusAutoNext} />
                    <Typography.Text type="secondary" className="text-xs">
                        Auto next
                    </Typography.Text>
                </label>

                <div className="flex items-center gap-2">
                    <Button
                        size="small"
                        icon={<CaretLeft size={13} />}
                        onClick={() => navigatePrev()}
                        disabled={!hasPrev}
                    >
                        Prev{" "}
                        <kbd className="px-1 rounded border border-solid border-current opacity-50 ml-0.5">
                            ←
                        </kbd>
                    </Button>
                    <Button
                        size="small"
                        onClick={() => navigateNext()}
                        disabled={!hasNext}
                        iconPosition="end"
                        icon={<CaretRight size={13} />}
                    >
                        Next{" "}
                        <kbd className="px-1 rounded border border-solid border-current opacity-50 ml-0.5">
                            →
                        </kbd>
                    </Button>
                    <Tooltip title={addToTestsetDisabledReason ?? undefined}>
                        <Button
                            size="small"
                            icon={<Plus size={13} />}
                            onClick={handleAddToTestset}
                            disabled={Boolean(addToTestsetDisabledReason)}
                            loading={isAddToTestsetExporting}
                        >
                            Add to Testset
                        </Button>
                    </Tooltip>
                    <Button
                        type="primary"
                        onClick={handleMarkComplete}
                        disabled={isSubmitting || !hasFilledMetrics}
                        loading={isSubmitting}
                        className="w-[160px]"
                        size="small"
                    >
                        {isCompleted ? "Update" : "Mark completed"}{" "}
                        <kbd className="px-1 rounded border border-solid border-current opacity-50 ml-0.5">
                            {modifierKey}↵
                        </kbd>
                    </Button>
                </div>
            </div>
        </div>
    )
}

export default SessionNavigation
