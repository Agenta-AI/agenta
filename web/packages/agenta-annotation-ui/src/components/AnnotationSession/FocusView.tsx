/**
 * FocusView
 *
 * Focus view for the annotation session: one item at a time.
 * Layout: content area (trace/testcase + annotation panel) | footer navigation bar.
 *
 * When all scenarios are completed, shows a "You're all caught up" empty state.
 */

import {memo, useCallback, useMemo} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import type {SessionView} from "@agenta/annotation"
import {message} from "@agenta/ui/app-message"
import {Check} from "@phosphor-icons/react"
import {Button, Skeleton, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useAnnotationNavigation} from "../../context/AnnotationUIContext"
import {useAnnotationKeyboardShortcuts} from "../../hooks/useAnnotationKeyboardShortcuts"
import ScenarioContent from "../ScenarioContent"

import AnnotationPanel from "./AnnotationPanel"
import SessionNavigation from "./SessionNavigation"

// ============================================================================
// TYPES
// ============================================================================

type ScenarioRecord = Record<string, unknown>

interface FocusViewProps {
    queueId: string
    onCompleted: (scenarioId: string) => void
    onViewChange?: (view: SessionView) => void
    onSyncToTestset?: () => void
    isSyncing?: boolean
}

// ============================================================================
// ALL CAUGHT UP EMPTY STATE
// ============================================================================

const AllCaughtUp = memo(function AllCaughtUp({
    onViewChange,
    onSyncToTestset,
    isSyncing,
}: {
    onViewChange?: (view: SessionView) => void
    onSyncToTestset?: () => void
    isSyncing?: boolean
}) {
    const navigation = useAnnotationNavigation()
    const queueKind = useAtomValue(annotationSessionController.selectors.queueKind())
    const setActiveView = useSetAtom(annotationSessionController.actions.setActiveView)
    const isTraces = queueKind === "traces"
    const isTestcases = queueKind === "testcases"

    const handleViewPrevious = useCallback(() => {
        if (onViewChange) {
            onViewChange("list")
            return
        }

        setActiveView("list" as SessionView)
    }, [onViewChange, setActiveView])

    const handleGoToObservability = useCallback(() => {
        navigation.navigateToObservability?.()
    }, [navigation])

    // For testcase queues: show direct sync action after all scenarios are annotated
    if (isTestcases && onSyncToTestset) {
        return (
            <div className="flex flex-col flex-1 items-center justify-center gap-4 min-h-0">
                <div className="flex items-center justify-center size-20 rounded-full bg-[var(--ant-color-fill-quaternary)]">
                    <Check size={32} className="text-[var(--ant-color-text-secondary)]" />
                </div>

                <div className="flex flex-col items-center gap-2 text-center">
                    <Typography.Text strong className="!text-base">
                        All scenarios annotated
                    </Typography.Text>
                    <Typography.Text type="secondary" className="text-sm">
                        Save your annotations back to the testset as a new version.
                    </Typography.Text>
                </div>

                <div className="flex items-center gap-2">
                    <Button size="small" onClick={handleViewPrevious}>
                        View previous annotations
                    </Button>
                    <Button
                        size="small"
                        type="primary"
                        loading={isSyncing}
                        onClick={onSyncToTestset}
                    >
                        Save to Testset
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col flex-1 items-center justify-center gap-4 min-h-0">
            <div className="flex items-center justify-center size-20 rounded-full bg-[var(--ant-color-fill-quaternary)]">
                <Check size={32} className="text-[var(--ant-color-text-secondary)]" />
            </div>

            <div className="flex flex-col items-center gap-2 text-center">
                <Typography.Text strong className="!text-base">
                    You&apos;re all caught up
                </Typography.Text>
                <Typography.Text type="secondary" className="text-sm">
                    All runs in this queue have been annotated.
                    <br />
                    {isTraces ? "Add more from Tracing." : "Add more from Test Sets."}
                </Typography.Text>
            </div>

            <div className="flex items-center gap-2">
                <Button size="small" onClick={handleViewPrevious}>
                    View previous annotations
                </Button>
                {isTraces && navigation.navigateToObservability && (
                    <Button size="small" type="primary" onClick={handleGoToObservability}>
                        Go to observability
                    </Button>
                )}
            </div>
        </div>
    )
})

// ============================================================================
// MAIN COMPONENT
// ============================================================================

const FocusView = memo(function FocusView({
    queueId,
    onCompleted,
    onViewChange,
    onSyncToTestset,
    isSyncing,
}: FocusViewProps) {
    const currentScenarioId = useAtomValue(
        annotationSessionController.selectors.currentScenarioId(),
    )
    const scenariosQuery = useAtomValue(annotationSessionController.selectors.scenariosQuery())
    const focusScenarioIds = useAtomValue(annotationSessionController.selectors.focusScenarioIds())
    const queueKind = useAtomValue(annotationSessionController.selectors.queueKind())
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(currentScenarioId ?? ""),
    )
    const testcaseRef = useAtomValue(
        annotationSessionController.selectors.scenarioTestcaseRef(currentScenarioId ?? ""),
    )
    const progress = useAtomValue(annotationSessionController.selectors.progress())

    // Read scenarios from controller (derived from simpleQueueMolecule)
    const scenarios = useAtomValue(
        annotationSessionController.selectors.scenarioRecords(),
    ) as ScenarioRecord[]

    const currentScenario = useMemo(
        () => scenarios.find((s) => s.id === currentScenarioId) ?? null,
        [scenarios, currentScenarioId],
    )

    // Keyboard shortcuts: arrow keys for nav, Cmd/Ctrl+Enter to submit
    const scenarioId = currentScenarioId ?? ""
    const hasNext = useAtomValue(annotationSessionController.selectors.hasNext())
    const hasPrev = useAtomValue(annotationSessionController.selectors.hasPrev())
    const isSubmitting = useAtomValue(annotationFormController.selectors.isSubmitting(scenarioId))
    const hasFilledMetrics = useAtomValue(
        annotationFormController.selectors.hasFilledMetrics(scenarioId),
    )
    const isCompleted = useAtomValue(annotationSessionController.selectors.isCurrentCompleted())
    const navigateNext = useSetAtom(annotationSessionController.actions.navigateNext)
    const navigatePrev = useSetAtom(annotationSessionController.actions.navigatePrev)
    const submitAnnotations = useSetAtom(annotationFormController.actions.submitAnnotations)

    const handleKeyboardSubmit = useCallback(async () => {
        if (!scenarioId) return
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

    useAnnotationKeyboardShortcuts({
        onPrev: () => navigatePrev(),
        onNext: () => navigateNext(),
        onSubmit: handleKeyboardSubmit,
        hasPrev,
        hasNext,
        canSubmit: !isSubmitting && hasFilledMetrics,
        enabled: !!currentScenarioId,
    })

    if (scenariosQuery.isPending) {
        return (
            <div className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 bg-[#f5f7fa] p-2 flex items-center justify-center">
                    <Skeleton active paragraph={{rows: 6}} className="max-w-2xl w-full" />
                </div>
            </div>
        )
    }

    if (scenariosQuery.isError) {
        return (
            <div className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 bg-[#f5f7fa] flex items-center justify-center">
                    <Typography.Text type="secondary">
                        Failed to load annotation scenarios
                    </Typography.Text>
                </div>
            </div>
        )
    }

    if (scenarios.length === 0) {
        return (
            <div className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 bg-[#f5f7fa] flex items-center justify-center">
                    <Typography.Text type="secondary">No scenarios available</Typography.Text>
                </div>
            </div>
        )
    }

    if (progress.remaining === 0) {
        return (
            <AllCaughtUp
                onViewChange={onViewChange}
                onSyncToTestset={onSyncToTestset}
                isSyncing={isSyncing}
            />
        )
    }

    if (focusScenarioIds.length === 0 && !currentScenarioId) {
        return (
            <div className="flex flex-col flex-1 min-h-0">
                <div className="flex-1 bg-[#f5f7fa] flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2 text-center">
                        <Typography.Text strong>No scenarios available</Typography.Text>
                        <Typography.Text type="secondary" className="text-sm">
                            Adjust the focus switches to continue annotating.
                        </Typography.Text>
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Main content area */}
            <div className="flex-1 bg-[#f5f7fa] p-2 overflow-hidden min-h-0 flex flex-col">
                <div className="flex flex-col md:flex-row h-full gap-4 overflow-hidden min-h-0">
                    {/* Scenario content */}
                    <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
                        <ScenarioContent
                            scenario={currentScenario}
                            queueKind={queueKind || "traces"}
                            traceId={traceRef.traceId}
                            testcaseId={testcaseRef.testcaseId}
                        />
                    </div>

                    {/* Annotation panel */}
                    <div className="w-full md:w-[300px] lg:w-[400px] xl:w-[450px] shrink-0 border border-solid border-[rgba(5,23,41,0.06)] rounded-lg overflow-hidden bg-white flex flex-col">
                        <AnnotationPanel scenarioId={currentScenarioId ?? ""} />
                    </div>
                </div>
            </div>

            {/* Footer navigation bar */}
            <div className="shrink-0 bg-white border-0 border-t border-solid border-[rgba(5,23,41,0.06)] px-4 h-[55px] flex items-center">
                <SessionNavigation
                    scenarioId={currentScenarioId ?? ""}
                    queueId={queueId}
                    onCompleted={onCompleted}
                />
            </div>
        </div>
    )
})

export default FocusView
