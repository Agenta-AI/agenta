/**
 * AnnotationSession
 *
 * Main session view for annotating queue scenarios.
 * Two views, switchable via tabs:
 *
 * - **List**: Table showing all items with status indicators
 * - **Annotate** (Focus): One item at a time with annotation panel
 *
 * Layout uses PageLayout from @agenta/ui — same pattern as EvaluationsView:
 * ┌─────────────────────────────────────────────────────────────┐
 * │ ← queueName            progress   [List] [Annotate]  (ℹ️) │
 * ├─────────────────────────────────────────────────────────────┤
 * │ (Active view content fills remaining space)                 │
 * └─────────────────────────────────────────────────────────────┘
 *
 * Data flow:
 * - Queue data loaded via `simpleQueueMolecule` (auto-fetched by queueId)
 * - Scenarios loaded via `simpleQueueMolecule.selectors.scenarios(queueId)` (reactive query)
 * - All queue-level and per-task data accessed via `annotationSessionController`
 * - Active view state managed by `annotationSessionController.selectors.activeView()`
 */

import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import type {SessionView} from "@agenta/annotation"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {PageLayout} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {Tray} from "@phosphor-icons/react"
import {Button, Spin, Tabs, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useAnnotationNavigation} from "../../context"

import ConfigurationView from "./ConfigurationView"
import FocusView from "./FocusView"
import ScenarioListView from "./ScenarioListView"

// ============================================================================
// TYPES
// ============================================================================

interface AnnotationSessionProps {
    queueId: string
    routeState: {
        view: SessionView
        scenarioId?: string
    }
    onActiveViewChange?: (view: SessionView) => void
}

// ============================================================================
// TAB ITEMS
// ============================================================================

const SESSION_TABS: {key: SessionView; label: string}[] = [
    {key: "annotate", label: "Annotate"},
    {key: "list", label: "All Anntations"},
    {key: "configuration", label: "Configuration"},
]

const TAB_ITEMS = SESSION_TABS.map((t) => ({key: t.key, label: t.label}))

// ============================================================================
// HEADER TITLE
// ============================================================================

const SessionTitle = memo(function SessionTitle({queueName}: {queueName: string}) {
    return <span className="truncate">{queueName}</span>
})

// ============================================================================
// HEADER RIGHT SECTION
// ============================================================================

const SessionHeaderRight = memo(function SessionHeaderRight({
    activeView,
    onTabChange,
}: {
    activeView: SessionView
    onTabChange: (key: string) => void
}) {
    return (
        <div className="flex items-center gap-4">
            <Tabs
                activeKey={activeView}
                onChange={onTabChange}
                items={TAB_ITEMS}
                className="[&_.ant-tabs-nav]:!mb-0"
                size="small"
            />
        </div>
    )
})

// ============================================================================
// EMPTY QUEUE STATE
// ============================================================================

const EmptyQueueState = memo(function EmptyQueueState({
    onViewChange,
}: {
    onViewChange: (view: SessionView) => void
}) {
    const navigation = useAnnotationNavigation()
    const queueKind = useAtomValue(annotationSessionController.selectors.queueKind())
    const isTraces = queueKind === "traces"

    return (
        <div className="flex flex-col flex-1 items-center justify-center gap-4 min-h-0">
            <div className="flex items-center justify-center size-20 rounded-full bg-[var(--ant-color-fill-quaternary)]">
                <Tray size={32} className="text-[var(--ant-color-text-secondary)]" />
            </div>

            <div className="flex flex-col items-center gap-2 text-center">
                <Typography.Text strong className="!text-base">
                    There&apos;s nothing to see here
                </Typography.Text>
                <Typography.Text type="secondary" className="text-sm">
                    Currently there are no runs &amp; annotations in this queue,
                    <br />
                    {isTraces ? "please add runs from traces." : "please add items from test sets."}
                </Typography.Text>
            </div>

            <div className="flex items-center gap-2">
                <Button size="small" onClick={() => onViewChange("list")}>
                    View previous annotations
                </Button>
                {isTraces && navigation.navigateToObservability && (
                    <Button
                        size="small"
                        type="primary"
                        className="!bg-[#051729] !border-[#051729] hover:!bg-[#0a2540] hover:!border-[#0a2540]"
                        onClick={() => navigation.navigateToObservability?.()}
                    >
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

const AnnotationSession = ({queueId, routeState, onActiveViewChange}: AnnotationSessionProps) => {
    // Queue data from molecule (auto-fetched by queueId)
    const queueQuery = useAtomValue(simpleQueueMolecule.selectors.query(queueId))
    const queue = useAtomValue(simpleQueueMolecule.selectors.data(queueId))
    const initialRouteStateRef = useRef(routeState)
    useEffect(() => {
        initialRouteStateRef.current = routeState
    })

    // Session controller actions
    const openQueue = useSetAtom(annotationSessionController.actions.openQueue)
    const closeSession = useSetAtom(annotationSessionController.actions.closeSession)
    const applyRouteState = useSetAtom(annotationSessionController.actions.applyRouteState)
    const setActiveView = useSetAtom(annotationSessionController.actions.setActiveView)
    const syncScenarioOrder = useSetAtom(annotationSessionController.actions.syncScenarioOrder)
    const syncToTestsets = useSetAtom(annotationSessionController.actions.syncToTestsets)

    // Sync to testset state
    const [isSyncing, setIsSyncing] = useState(false)

    // Session controller selectors — queue-level
    const queueName = useAtomValue(annotationSessionController.selectors.queueName())
    const controllerActiveView = useAtomValue(annotationSessionController.selectors.activeView())
    const resolvedActiveView = controllerActiveView

    // Scenarios — derived reactively from simpleQueueMolecule via the controller
    const scenarioCount = useAtomValue(annotationSessionController.selectors.scenarioIds()).length
    const scenariosQuery = useAtomValue(annotationSessionController.selectors.scenariosQuery())

    // Open the session when queueId is set
    useEffect(() => {
        if (!queueId) return

        const initialRouteState = initialRouteStateRef.current
        openQueue({
            queueId,
            queueType: "simple",
            initialView: initialRouteState.view,
            initialScenarioId: initialRouteState.scenarioId ?? null,
        })

        return () => {
            closeSession()
            annotationFormController.set.clearFormState()
        }
    }, [queueId, closeSession, openQueue])

    useEffect(() => {
        applyRouteState({
            view: routeState.view,
            scenarioId: routeState.scenarioId,
        })
    }, [applyRouteState, routeState.view, routeState.scenarioId, scenarioCount])

    useEffect(() => {
        syncScenarioOrder()
    }, [syncScenarioOrder, scenariosQuery.data])

    // Callbacks for AnnotationPanel notifications
    const handleSaved = useCallback(() => {
        message.success("Annotations saved")
    }, [])

    const handleCompleted = useCallback((scenarioId: string) => {
        message.success("Scenario completed")
    }, [])

    const handleActiveViewChange = useCallback(
        (nextView: SessionView) => {
            setActiveView(nextView)
            if (nextView !== controllerActiveView) {
                onActiveViewChange?.(nextView)
            }
        },
        [controllerActiveView, onActiveViewChange, setActiveView],
    )

    const handleTabChange = useCallback(
        (key: string) => {
            handleActiveViewChange(key as SessionView)
        },
        [handleActiveViewChange],
    )

    const handleSyncToTestset = useCallback(async () => {
        setIsSyncing(true)
        try {
            const result = await syncToTestsets()

            const summary = `Created ${result.revisionsCreated} revision${
                result.revisionsCreated === 1 ? "" : "s"
            }, exported ${result.rowsExported} row${result.rowsExported === 1 ? "" : "s"}`

            if (result.failedTargets.length > 0) {
                message.warning(summary)
            } else {
                message.success(summary)
            }
        } catch (err) {
            const errorMessage =
                err instanceof Error && err.message
                    ? err.message
                    : "Failed to save annotations to testsets"
            message.error(errorMessage)
            console.error("[syncToTestsets]", err)
        } finally {
            setIsSyncing(false)
        }
    }, [syncToTestsets])

    // Header title (queue name)
    const headerTitle = useMemo(
        () => (
            <div className="flex flex-col items-start">
                <div className="flex items-center">
                    <SessionTitle queueName={queueName || "Untitled Queue"} />
                </div>
                {/* Progress */}
                {/* <div className="flex items-center gap-2 shrink-0">
                    <Typography.Text type="secondary" className="text-xs whitespace-nowrap">
                        {progress.completed} / {progress.total} complete
                    </Typography.Text>
                    <Progress
                        percent={percent}
                        size="small"
                        className="w-24 !mb-0"
                        showInfo={false}
                    />
                </div> */}
            </div>
        ),
        [queueName],
    )

    // Header right section (tabs + sync button)
    const headerTabs = useMemo(
        () => <SessionHeaderRight activeView={resolvedActiveView} onTabChange={handleTabChange} />,
        [resolvedActiveView, handleTabChange],
    )

    // Loading state — queue query or scenarios query pending
    const isLoading = queueQuery.isPending || (queue && scenariosQuery.isPending)

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-full py-20">
                <Spin size="large" />
            </div>
        )
    }

    // Queue not found
    if (!queue) {
        return (
            <div className="flex items-center justify-center h-full py-20">
                <Typography.Text type="secondary">Queue not found</Typography.Text>
            </div>
        )
    }

    return (
        <PageLayout
            title={headerTitle}
            titleLevel={4}
            headerTabs={headerTabs}
            className="!p-0 h-full min-h-0 !gap-2"
            headerClassName="px-4"
        >
            {/* Content */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                {resolvedActiveView === "configuration" ? (
                    <ConfigurationView queueId={queueId} />
                ) : scenarioCount === 0 ? (
                    <EmptyQueueState onViewChange={handleActiveViewChange} />
                ) : resolvedActiveView === "list" ? (
                    <ScenarioListView
                        queueId={queueId}
                        onSaved={handleSaved}
                        onCompleted={handleCompleted}
                        onViewChange={handleActiveViewChange}
                    />
                ) : (
                    <FocusView
                        queueId={queueId}
                        onCompleted={handleCompleted}
                        onViewChange={handleActiveViewChange}
                        onSyncToTestset={handleSyncToTestset}
                        isSyncing={isSyncing}
                    />
                )}
            </div>
        </PageLayout>
    )
}

export default AnnotationSession
