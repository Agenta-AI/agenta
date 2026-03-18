/**
 * SessionNavigation
 *
 * Top navigation bar for the annotation session.
 * Previous/Next arrows, scenario selector dropdown, remaining count,
 * and trace info (span name, type, "View Full Trace" link) when applicable.
 */

import {useCallback, useMemo} from "react"

import {annotationSessionController} from "@agenta/annotation"
import {traceRootSpanAtomFamily} from "@agenta/entities/trace"
import {ArrowSquareOut, CaretLeft, CaretRight} from "@phosphor-icons/react"
import {Button, Select, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useAnnotationNavigation} from "../../context"
import AnnotationStatusFilterSelect from "../AnnotationStatusFilterSelect"

const SessionNavigation = () => {
    const navigation = useAnnotationNavigation()

    const hasNext = useAtomValue(annotationSessionController.selectors.hasNext())
    const hasPrev = useAtomValue(annotationSessionController.selectors.hasPrev())
    const progress = useAtomValue(annotationSessionController.selectors.progress())
    const scenarioIds = useAtomValue(annotationSessionController.selectors.focusScenarioIds())
    const currentIndex = useAtomValue(annotationSessionController.selectors.currentScenarioIndex())
    const focusStatusFilter = useAtomValue(
        annotationSessionController.selectors.focusStatusFilter(),
    )

    // Trace info for current scenario
    const currentScenarioId = useAtomValue(
        annotationSessionController.selectors.currentScenarioId(),
    )
    const queueKind = useAtomValue(annotationSessionController.selectors.queueKind())
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(currentScenarioId ?? ""),
    )
    const isTrace = queueKind === "traces" && !!traceRef.traceId
    const rootSpan = useAtomValue(traceRootSpanAtomFamily(isTrace ? traceRef.traceId : null))

    const navigateNext = useSetAtom(annotationSessionController.actions.navigateNext)
    const navigatePrev = useSetAtom(annotationSessionController.actions.navigatePrev)
    const navigateToIndex = useSetAtom(annotationSessionController.actions.navigateToIndex)
    const setFocusStatusFilter = useSetAtom(
        annotationSessionController.actions.setFocusStatusFilter,
    )

    const handleSelect = useCallback(
        (value: number) => {
            navigateToIndex(value)
        },
        [navigateToIndex],
    )

    const handleViewTrace = useCallback(() => {
        if (traceRef.traceId && navigation.openTraceDetail) {
            navigation.openTraceDetail(traceRef.traceId, rootSpan?.span_id)
        }
    }, [traceRef.traceId, rootSpan?.span_id, navigation])

    const options = useMemo(
        () =>
            scenarioIds.map((_, index) => ({
                value: index,
                label: `Scenario #${index + 1}`,
            })),
        [scenarioIds],
    )

    return (
        <div className="w-full flex items-center justify-between gap-3 shrink-0">
            <div className="flex items-center gap-3">
                <Button
                    type="text"
                    size="small"
                    icon={<CaretLeft size={16} />}
                    onClick={() => navigatePrev()}
                    disabled={!hasPrev}
                />
                <Button
                    type="text"
                    size="small"
                    icon={<CaretRight size={16} />}
                    onClick={() => navigateNext()}
                    disabled={!hasNext}
                />

                <Select
                    value={scenarioIds.length > 0 ? currentIndex : undefined}
                    onChange={handleSelect}
                    options={options}
                    size="small"
                    className="min-w-[140px]"
                    popupMatchSelectWidth={false}
                    disabled={scenarioIds.length === 0}
                />

                <AnnotationStatusFilterSelect
                    value={focusStatusFilter}
                    onChange={setFocusStatusFilter}
                    size="small"
                    className="min-w-[120px]"
                    popupMatchSelectWidth={false}
                />

                <Typography.Text type="secondary" className="text-xs whitespace-nowrap">
                    {progress.remaining} of {progress.total} remaining
                </Typography.Text>
            </div>

            <div className="flex items-center gap-3">
                {/* Trace info */}
                {isTrace && rootSpan?.span_name && (
                    <div className="flex items-center gap-2">
                        <Typography.Text className="text-xs font-medium">
                            {rootSpan.span_name}
                        </Typography.Text>
                        {rootSpan.span_type && (
                            <Typography.Text type="secondary" className="text-xs">
                                {rootSpan.span_type}
                            </Typography.Text>
                        )}
                    </div>
                )}

                {isTrace && navigation.openTraceDetail && (
                    <Button
                        size="small"
                        type="text"
                        icon={<ArrowSquareOut size={14} />}
                        onClick={handleViewTrace}
                    >
                        View Full Trace
                    </Button>
                )}
            </div>
        </div>
    )
}

export default SessionNavigation
