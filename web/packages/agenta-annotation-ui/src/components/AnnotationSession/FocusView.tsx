/**
 * FocusView
 *
 * Focus view for the annotation session: one item at a time.
 * Layout: top navigation | content (trace/testcase) | annotation panel.
 *
 * When all scenarios are completed, shows a "You're all caught up" empty state.
 */

import {memo, useCallback, useMemo} from "react"

import {annotationSessionController} from "@agenta/annotation"
import type {SessionView} from "@agenta/annotation"
import {Check} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useAnnotationNavigation} from "../../context/AnnotationUIContext"
import ScenarioContent from "../ScenarioContent"

import AnnotationPanel from "./AnnotationPanel"
import SessionNavigation from "./SessionNavigation"

// ============================================================================
// TYPES
// ============================================================================

type ScenarioRecord = Record<string, unknown>

interface FocusViewProps {
    queueId: string
    onSaved: () => void
    onCompleted: (scenarioId: string) => void
}

// ============================================================================
// ALL CAUGHT UP EMPTY STATE
// ============================================================================

const AllCaughtUp = memo(function AllCaughtUp() {
    const navigation = useAnnotationNavigation()
    const setActiveView = useSetAtom(annotationSessionController.actions.setActiveView)

    const handleViewPrevious = useCallback(() => {
        setActiveView("list" as SessionView)
    }, [setActiveView])

    const handleGoToObservability = useCallback(() => {
        navigation.navigateToObservability?.()
    }, [navigation])

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
                    Add more from Tracing.
                </Typography.Text>
            </div>

            <div className="flex items-center gap-2">
                <Button size="small" onClick={handleViewPrevious}>
                    View previous annotations
                </Button>
                {navigation.navigateToObservability && (
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

const FocusView = memo(function FocusView({queueId, onSaved, onCompleted}: FocusViewProps) {
    const currentScenarioId = useAtomValue(
        annotationSessionController.selectors.currentScenarioId(),
    )
    const queueKind = useAtomValue(annotationSessionController.selectors.queueKind())
    const traceRef = useAtomValue(
        annotationSessionController.selectors.scenarioTraceRef(currentScenarioId ?? ""),
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

    if (scenarios.length === 0) return null

    // All scenarios completed — show empty state
    if (progress.remaining === 0) {
        return <AllCaughtUp />
    }

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Top navigation (includes trace info) */}
            <SessionNavigation />

            <div className="flex-1 flex overflow-hidden min-h-0">
                {/* Scenario content */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    <ScenarioContent
                        scenario={currentScenario}
                        queueKind={queueKind || "traces"}
                        traceId={traceRef.traceId}
                    />
                </div>

                {/* Annotation panel */}
                <div className="w-[340px] min-w-[280px]">
                    <AnnotationPanel
                        scenarioId={currentScenarioId ?? ""}
                        queueId={queueId}
                        onSaved={onSaved}
                        onCompleted={onCompleted}
                    />
                </div>
            </div>
        </div>
    )
})

export default FocusView
