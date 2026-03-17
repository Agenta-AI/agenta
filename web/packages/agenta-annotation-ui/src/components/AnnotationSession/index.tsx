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

import {memo, useCallback, useEffect, useMemo} from "react"

import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import type {SessionView} from "@agenta/annotation"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {PageLayout} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {Editor} from "@agenta/ui/editor"
import {Info} from "@phosphor-icons/react"
import {Button, Popover, Progress, Spin, Tabs, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import ConfigurationView from "./ConfigurationView"
import FocusView from "./FocusView"
import ScenarioListView from "./ScenarioListView"

// ============================================================================
// TYPES
// ============================================================================

interface AnnotationSessionProps {
    queueId: string
}

// ============================================================================
// TAB ITEMS
// ============================================================================

const SESSION_TABS: {key: SessionView; label: string}[] = [
    {key: "annotate", label: "Annotate"},
    {key: "list", label: "All Traces"},
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
// INSTRUCTIONS POPOVER
// ============================================================================

const INSTRUCTIONS_EDITOR_ID = "annotation-session-instructions"

const InstructionsTrigger = memo(function InstructionsTrigger({
    instructions,
}: {
    instructions: string
}) {
    return (
        <Popover
            trigger="click"
            placement="bottomRight"
            destroyOnHidden
            content={
                <div
                    className="overflow-y-auto"
                    style={{
                        width: "min(640px, calc(100vw - 32px))",
                        maxHeight: "min(320px, calc(100vh - 160px))",
                    }}
                >
                    <Editor
                        id={INSTRUCTIONS_EDITOR_ID}
                        initialValue={instructions}
                        disabled
                        showToolbar={false}
                        showBorder={false}
                        enableTokens={false}
                        showMarkdownToggleButton={false}
                    />
                </div>
            }
        >
            <Button type="text" size="small" icon={<Info size={16} />} />
        </Popover>
    )
})

// ============================================================================
// HEADER RIGHT SECTION (progress + tabs + instructions)
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
// MAIN COMPONENT
// ============================================================================

const AnnotationSession = ({queueId}: AnnotationSessionProps) => {
    // Queue data from molecule (auto-fetched by queueId)
    const queueQuery = useAtomValue(simpleQueueMolecule.selectors.query(queueId))
    const queue = useAtomValue(simpleQueueMolecule.selectors.data(queueId))

    // Session controller actions
    const openQueue = useSetAtom(annotationSessionController.actions.openQueue)
    const closeSession = useSetAtom(annotationSessionController.actions.closeSession)
    const setActiveView = useSetAtom(annotationSessionController.actions.setActiveView)
    const markCompleted = useSetAtom(annotationSessionController.actions.markCompleted)

    // Session controller selectors — queue-level
    const progress = useAtomValue(annotationSessionController.selectors.progress())
    const queueName = useAtomValue(annotationSessionController.selectors.queueName())
    const queueDescription = useAtomValue(annotationSessionController.selectors.queueDescription())
    const activeView = useAtomValue(annotationSessionController.selectors.activeView())

    // Scenarios — derived reactively from simpleQueueMolecule via the controller
    const scenarioCount = useAtomValue(annotationSessionController.selectors.scenarioIds()).length
    const scenariosQuery = useAtomValue(annotationSessionController.selectors.scenariosQuery())

    // Open the session when queueId is set
    useEffect(() => {
        if (!queueId) return

        openQueue({queueId, queueType: "simple"})

        return () => {
            closeSession()
            annotationFormController.set.clearFormState()
        }
    }, [queueId])

    // Callbacks for AnnotationPanel notifications
    const handleSaved = useCallback(() => {
        message.success("Annotations saved")
    }, [])

    const handleCompleted = useCallback(
        (scenarioId: string) => {
            markCompleted(scenarioId)
            message.success("Scenario completed")
        },
        [markCompleted],
    )

    const handleTabChange = useCallback(
        (key: string) => {
            setActiveView(key as SessionView)
        },
        [setActiveView],
    )

    const percent = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0
    // Header title (queue name)
    const headerTitle = useMemo(
        () => (
            <div className="flex flex-col items-start">
                <div className="flex items-center">
                    <SessionTitle queueName={queueName || "Untitled Queue"} />
                    {queueDescription && <InstructionsTrigger instructions={queueDescription} />}
                </div>
                {/* Progress */}
                <div className="flex items-center gap-2 shrink-0">
                    <Typography.Text type="secondary" className="text-xs whitespace-nowrap">
                        {progress.completed} / {progress.total} complete
                    </Typography.Text>
                    <Progress
                        percent={percent}
                        size="small"
                        className="w-24 !mb-0"
                        showInfo={false}
                    />
                </div>
            </div>
        ),
        [queueName, queueDescription, progress.completed, progress.total, percent],
    )

    // Header right section (instructions + progress + tabs)
    const headerTabs = useMemo(
        () => <SessionHeaderRight activeView={activeView} onTabChange={handleTabChange} />,
        [activeView, handleTabChange],
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
        <PageLayout title={headerTitle} headerTabs={headerTabs} className="h-full min-h-0">
            {/* Content */}
            <div className="flex-1 flex flex-col overflow-hidden min-h-0">
                {activeView === "configuration" ? (
                    <ConfigurationView queueId={queueId} />
                ) : scenarioCount === 0 ? (
                    <div className="flex items-center justify-center flex-1 py-20">
                        <Typography.Text type="secondary">
                            No items in this queue yet. Add traces or test cases to get started.
                        </Typography.Text>
                    </div>
                ) : activeView === "list" ? (
                    <ScenarioListView
                        queueId={queueId}
                        onSaved={handleSaved}
                        onCompleted={handleCompleted}
                    />
                ) : (
                    <FocusView
                        queueId={queueId}
                        onSaved={handleSaved}
                        onCompleted={handleCompleted}
                    />
                )}
            </div>
        </PageLayout>
    )
}

export default AnnotationSession
