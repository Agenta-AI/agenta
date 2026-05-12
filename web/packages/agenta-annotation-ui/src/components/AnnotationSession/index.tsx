import {useCallback, useEffect, useMemo, useRef} from "react"

import type {SessionView} from "@agenta/annotation"
import {annotationFormController, annotationSessionController} from "@agenta/annotation"
import {simpleQueueMolecule} from "@agenta/entities/simpleQueue"
import {
    EntityCommitModal,
    EntityPicker,
    type CommitSubmitParams,
    type CommitSubmitResult,
} from "@agenta/entity-ui"
import {PageLayout} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {Spin, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {useAnnotationNavigation} from "../../context"

import {
    ADD_TO_TESTSET_COMMIT_MODES,
    ADD_TO_TESTSET_TARGET_ADAPTER,
    CREATE_TESTSET_FIELDS,
} from "./assets/constants"
import type {AddToTestsetTargetSelection, AnnotationSessionProps} from "./assets/type"
import ConfigurationView from "./ConfigurationView"
import EmptyQueueState from "./EmptyQueueState"
import FocusView from "./FocusView"
import ScenarioListView from "./ScenarioListView"
import SessionHeaderRight from "./SessionHeaderRight"
import SessionTitle from "./SessionTitle"

const AnnotationSession = ({
    queueId,
    routeState,
    onActiveViewChange,
    canExportData = true,
}: AnnotationSessionProps) => {
    const navigation = useAnnotationNavigation()

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
    const closeAddToTestsetModal = useSetAtom(
        annotationSessionController.actions.closeAddToTestsetModal,
    )
    const setPendingTestsetSelection = useSetAtom(
        annotationSessionController.actions.setPendingTestsetSelection,
    )
    const addScenariosToTestset = useSetAtom(
        annotationSessionController.actions.addScenariosToTestset,
    )

    // Session controller selectors — queue-level
    const queueName = useAtomValue(annotationSessionController.selectors.queueName())
    const controllerActiveView = useAtomValue(annotationSessionController.selectors.activeView())
    const resolvedActiveView = controllerActiveView
    const isAddToTestsetModalOpen = useAtomValue(
        annotationSessionController.selectors.isAddToTestsetModalOpen(),
    )
    const pendingTestsetSelection = useAtomValue(
        annotationSessionController.selectors.pendingTestsetSelection(),
    )
    const addToTestsetExportJob = useAtomValue(
        annotationSessionController.selectors.addToTestsetExportJob(),
    )
    const isAddToTestsetExporting = useAtomValue(
        annotationSessionController.selectors.isAddToTestsetExporting(),
    )
    // Scenarios — derived reactively from simpleQueueMolecule via the controller
    const allScenarioIds = useAtomValue(annotationSessionController.selectors.scenarioIds())
    const scenarioCount = allScenarioIds.length
    const scenariosQuery = useAtomValue(annotationSessionController.selectors.scenariosQuery())
    const notifiedExportJobIdRef = useRef<string | null>(null)

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

    const handleCompleted = useCallback((_scenarioId: string) => {
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

    useEffect(() => {
        if (!addToTestsetExportJob.id) return
        if (notifiedExportJobIdRef.current === addToTestsetExportJob.id) return

        if (addToTestsetExportJob.status === "success") {
            notifiedExportJobIdRef.current = addToTestsetExportJob.id
            const {processed, targetRevisionId, targetTestsetName} = addToTestsetExportJob
            const label = targetTestsetName ?? "testset"
            message.success({
                content: `Added ${processed} row${processed === 1 ? "" : "s"} to ${label}.`,
                onNavigate:
                    targetRevisionId && navigation.navigateToTestset
                        ? () => navigation.navigateToTestset!(targetRevisionId)
                        : undefined,
                linkText: `View "${label}"`,
                duration: 5,
            })
        }
    }, [addToTestsetExportJob])

    const handleTestsetSelect = useCallback(
        (selection: AddToTestsetTargetSelection) => {
            setPendingTestsetSelection({
                testsetId: selection.metadata.testsetId,
                testsetName: selection.metadata.testsetName,
            })
        },
        [setPendingTestsetSelection],
    )

    const handleTestsetDeselect = useCallback(() => {
        setPendingTestsetSelection({testsetId: null})
    }, [setPendingTestsetSelection])

    const handleAddToTestsetModeChange = useCallback(
        (mode: string | undefined) => {
            if (mode === "new") {
                setPendingTestsetSelection({testsetId: null})
            }
        },
        [setPendingTestsetSelection],
    )

    const handleAddToTestsetSubmit = useCallback(
        async (params: CommitSubmitParams): Promise<CommitSubmitResult> => {
            try {
                await addScenariosToTestset({
                    targetMode: params.mode === "new" ? "new" : "existing",
                    commitMessage: params.message,
                    newTestsetName: params.entityName,
                    newTestsetSlug: params.entitySlug,
                })
                return {success: true}
            } catch (error) {
                return {
                    success: false,
                    error:
                        error instanceof Error && error.message
                            ? error.message
                            : "Failed to start testset export",
                }
            }
        },
        [addScenariosToTestset],
    )

    const canSubmitAddToTestset = useCallback(
        ({mode}: {mode?: string}) => {
            if (isAddToTestsetExporting) return false
            if (mode === "new") return true
            return Boolean(pendingTestsetSelection)
        },
        [isAddToTestsetExporting, pendingTestsetSelection],
    )

    const renderAddToTestsetModeContent = useCallback(
        ({mode}: {mode?: string}) => (
            <div className="flex flex-col gap-3">
                {mode !== "new" && (
                    <EntityPicker<AddToTestsetTargetSelection>
                        variant="cascading"
                        adapter={ADD_TO_TESTSET_TARGET_ADAPTER}
                        initialSelections={[pendingTestsetSelection]}
                        showLabels
                        showAutoIndicator={false}
                        placeholders={["Select testset"]}
                        onSelect={handleTestsetSelect}
                        onDeselect={handleTestsetDeselect}
                    />
                )}
            </div>
        ),
        [handleTestsetSelect, handleTestsetDeselect, pendingTestsetSelection],
    )

    // Header right section (tabs + sync button)
    const headerTabs = useMemo(
        () => <SessionHeaderRight activeView={resolvedActiveView} onTabChange={handleTabChange} />,
        [resolvedActiveView, handleTabChange],
    )

    const headerTitle = useMemo(
        () => <SessionTitle queueName={queueName || "Untitled Queue"} />,
        [queueName],
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
                        canExportData={canExportData}
                    />
                ) : (
                    <FocusView
                        queueId={queueId}
                        onCompleted={handleCompleted}
                        onViewChange={handleActiveViewChange}
                    />
                )}
            </div>
            <EntityCommitModal
                open={isAddToTestsetModalOpen}
                onClose={closeAddToTestsetModal}
                entity={{
                    type: "simpleQueue",
                    id: queueId,
                }}
                onSubmit={handleAddToTestsetSubmit}
                commitModes={ADD_TO_TESTSET_COMMIT_MODES}
                defaultCommitMode="existing"
                onModeChange={handleAddToTestsetModeChange}
                renderModeContent={renderAddToTestsetModeContent}
                canSubmit={canSubmitAddToTestset}
                createEntityFields={CREATE_TESTSET_FIELDS}
                submitLabel="Add"
                actionLabel="Add to Testset"
            />
        </PageLayout>
    )
}

export default AnnotationSession
