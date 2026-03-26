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
import {message} from "@agenta/ui/app-message"
import {CopyTooltip} from "@agenta/ui/copy-tooltip"
import {ArrowSquareOut, CaretLeft, CaretRight, Copy} from "@phosphor-icons/react"
import {Button, Select, Switch, Tag, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useAnnotationNavigation} from "../../context"

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
    const isCompleted = useAtomValue(annotationSessionController.selectors.isCurrentCompleted())
    const submitAnnotations = useSetAtom(annotationFormController.actions.submitAnnotations)

    const navigateNext = useSetAtom(annotationSessionController.actions.navigateNext)
    const navigatePrev = useSetAtom(annotationSessionController.actions.navigatePrev)
    const navigateToIndex = useSetAtom(annotationSessionController.actions.navigateToIndex)
    const setHideCompletedInFocus = useSetAtom(
        annotationSessionController.actions.setHideCompletedInFocus,
    )
    const setFocusAutoNext = useSetAtom(annotationSessionController.actions.setFocusAutoNext)

    const handleSelect = useCallback(
        (value: number) => {
            navigateToIndex(value)
        },
        [navigateToIndex],
    )

    const handleMarkComplete = useCallback(async () => {
        try {
            await submitAnnotations({scenarioId, queueId, markComplete: true})
            onCompleted?.(scenarioId)
        } catch (err) {
            message.error((err as Error).message || "Failed to submit annotations")
        }
    }, [submitAnnotations, scenarioId, queueId, onCompleted])

    const handleViewTrace = useCallback(() => {
        if (traceRef.traceId && navigation.openTraceDetail) {
            navigation.openTraceDetail({
                traceId: traceRef.traceId,
                spanId: rootSpan?.span_id ?? null,
            })
        }
    }, [traceRef.traceId, rootSpan?.span_id, navigation])

    const displayId = isTrace ? traceRef.traceId : testcaseRef.testcaseId

    const options = useMemo(
        () =>
            scenarioIds.map((_, index) => ({
                value: index,
                label: `${index + 1} / ${totalScenarios}`,
            })),
        [scenarioIds, totalScenarios],
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
                        Prev
                    </Button>
                    <Button
                        size="small"
                        onClick={() => navigateNext()}
                        disabled={!hasNext}
                        iconPosition="end"
                        icon={<CaretRight size={13} />}
                    >
                        Next
                    </Button>
                    <Button
                        type="primary"
                        onClick={handleMarkComplete}
                        disabled={isSubmitting || isCompleted || !hasFilledMetrics}
                        loading={isSubmitting}
                        className="w-[130px]"
                    >
                        {isCompleted ? "Completed" : "Mark completed"}
                    </Button>
                </div>
            </div>
        </div>
    )
}

export default SessionNavigation
