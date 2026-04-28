/**
 * WorkflowRevisionDrawerWrapper
 *
 * OSS global wrapper that provides concrete components to the unified drawer.
 * Mounted in AppGlobalWrappers — replaces both VariantDrawerWrapper and EvaluatorDrawersWrapper.
 *
 * The drawer IS a playground from the start. Expanding simply toggles
 * PlaygroundMainView between configOnly and full viewMode — no component
 * tree swap, no remounting.
 */
import {memo, useCallback, useEffect, useMemo, useRef} from "react"

import {loadableStateAtomFamily} from "@agenta/entities/loadable"
import {testcaseMolecule} from "@agenta/entities/testcase"
import {
    registerWorkflowCommitCallbacks,
    getWorkflowCommitCallbacks,
    parseEvaluatorKeyFromUri,
    evaluatorTemplatesMapAtom,
    workflowMolecule,
    discardLocalServerDataAtom,
} from "@agenta/entities/workflow"
import {EntityPicker} from "@agenta/entity-ui"
import {PlaygroundConfigSection} from "@agenta/entity-ui/drill-in"
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {VariantDetailsWithStatus, VariantNameCell} from "@agenta/entity-ui/variant"
import {playgroundController} from "@agenta/playground"
import {
    clearAllRunsMutationAtom,
    connectedTestsetAtom,
    derivedLoadableIdAtom,
    playgroundInitializedAtom,
} from "@agenta/playground/state"
import {type PlaygroundUIProviders} from "@agenta/playground-ui"
import {
    DrawerProvidersProvider,
    isCreateContext,
    workflowRevisionDrawerAtom,
    workflowRevisionDrawerContextAtom,
    closeWorkflowRevisionDrawerAtom,
    workflowRevisionDrawerCallbackAtom,
    workflowRevisionDrawerEntityIdAtom,
    workflowRevisionDrawerExpandedAtom,
    workflowRevisionDrawerOpenAtom,
    workflowRevisionDrawerViewModeAtom,
    WorkflowRevisionDrawer,
    type DrawerProviders,
} from "@agenta/playground-ui/workflow-revision-drawer"
import {EnvironmentTag} from "@agenta/ui"
import {Rocket} from "@phosphor-icons/react"
import {Button, Typography, message} from "antd"
import {getDefaultStore, useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import OSSdrillInUIProvider from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {
    connectAppToEvaluatorAtom,
    persistedAppSelectionAtom,
    persistedTestsetSelectionAtom,
    selectedAppLabelAtom,
} from "@/oss/components/Evaluators/components/ConfigureEvaluator/atoms"
import EvaluatorPlaygroundHeader from "@/oss/components/Evaluators/components/ConfigureEvaluator/EvaluatorPlaygroundHeader"
import {clearEvaluatorWorkflowCache} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import {invalidateAppManagementWorkflowQueries} from "@/oss/components/pages/app-management/store"
import CommitVariantChangesButton from "@/oss/components/Playground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
import DeployVariantButton from "@/oss/components/Playground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"
import PlaygroundTestcaseEditor from "@/oss/components/Playground/Components/PlaygroundTestcaseEditor"
import {OSSPlaygroundShell} from "@/oss/components/Playground/OSSPlaygroundShell"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"
import {useQueryParamState} from "@/oss/state/appState"

const PlaygroundMainView = dynamic(
    () => import("@/oss/components/Playground/Components/MainLayout"),
    {ssr: false},
)

const HumanEvaluatorDrawer = dynamic(
    () => import("@/oss/components/Evaluators/Drawers/HumanEvaluatorDrawer"),
    {ssr: false},
)

// ================================================================
// EVALUATOR TYPE LABEL
// ================================================================

const EvaluatorTypeLabel = memo(({revisionId}: {revisionId: string}) => {
    const data = useAtomValue(workflowMolecule.selectors.data(revisionId))
    const templatesMap = useAtomValue(evaluatorTemplatesMapAtom)

    const label = useMemo(() => {
        const uri = (data?.data as {uri?: string} | undefined)?.uri
        if (!uri || !uri.startsWith("agenta:builtin:")) return null
        const key = parseEvaluatorKeyFromUri(uri)
        return key ? (templatesMap.get(key) ?? key) : null
    }, [data?.data, templatesMap])

    if (!label) return null

    return <span className="text-xs px-2 py-0.5 rounded bg-blue-50 text-blue-600">{label}</span>
})

// ================================================================
// PLAYGROUND BUTTON
// ================================================================

const PlaygroundButton = memo(({revisionId}: {revisionId: string}) => {
    const {goToPlayground} = usePlaygroundNavigation()
    return (
        <Button
            className="flex items-center gap-2"
            size="small"
            onClick={() => goToPlayground(revisionId)}
        >
            <Rocket size={14} />
            Playground
        </Button>
    )
})

// ================================================================
// DRAWER PLAYGROUND
// The drawer is a playground. Expanding toggles the execution panel.
// ================================================================

/**
 * App playground mode — sets entity IDs directly (no URL sync needed).
 */
const DrawerAppPlayground = memo(({entityId}: {entityId: string}) => {
    const isExpanded = useAtomValue(workflowRevisionDrawerExpandedAtom)
    const [configViewMode, setConfigViewMode] = useAtom(workflowRevisionDrawerViewModeAtom)

    const setEntityIds = useSetAtom(playgroundController.actions.setEntityIds)
    useEffect(() => {
        if (entityId) {
            setEntityIds([entityId])
        }
        return () => {
            setEntityIds([])
        }
    }, [entityId, setEntityIds])

    const providers = useMemo(
        () =>
            ({
                SimpleSharedEditor,
                SharedGenerationResultUtils,
                TestcaseEditor: PlaygroundTestcaseEditor,
            }) as unknown as PlaygroundUIProviders,
        [],
    )

    return (
        <OSSPlaygroundShell providers={providers}>
            <PlaygroundMainView
                mode="app"
                viewMode={isExpanded ? "full" : "configOnly"}
                embedded
                configViewMode={configViewMode}
                onConfigViewModeChange={setConfigViewMode}
            />
        </OSSPlaygroundShell>
    )
})

/**
 * Evaluator playground mode — mirrors ConfigureEvaluatorPage.
 * Uses the same atoms (connectAppToEvaluatorAtom, evaluatorConfigEntityIdsAtom,
 * hasAppConnectedAtom) and same PlaygroundMainView props.
 *
 * Key difference from ConfigureEvaluatorPage: no playgroundSyncAtom (URL-driven),
 * instead uses setEntityIds + playgroundInitializedAtom for drawer-based init.
 */
const DrawerEvaluatorPlayground = memo(({entityId}: {entityId: string}) => {
    const isExpanded = useAtomValue(workflowRevisionDrawerExpandedAtom)
    const [configViewMode, setConfigViewMode] = useAtom(workflowRevisionDrawerViewModeAtom)

    // Initialize playground with the evaluator entity via addPrimaryNode
    // (same path as playgroundSyncAtom). This properly links the loadable,
    // creates initial testcase rows, and sets up the local testset.
    const addPrimaryNode = useSetAtom(playgroundController.actions.addPrimaryNode)
    const resetAll = useSetAtom(playgroundController.actions.resetAll)
    const clearAllRuns = useSetAtom(clearAllRunsMutationAtom)
    const setInitialized = useSetAtom(playgroundInitializedAtom)
    const setSelectedAppLabel = useSetAtom(selectedAppLabelAtom)
    const setConnectedTestset = useSetAtom(connectedTestsetAtom)
    const connectApp = useSetAtom(connectAppToEvaluatorAtom)
    const setPersistedTestset = useSetAtom(persistedTestsetSelectionAtom)
    useEffect(() => {
        if (entityId) {
            addPrimaryNode({type: "workflow", id: entityId, label: "Evaluator"})
            setInitialized(true)

            const store = getDefaultStore()

            // Restore persisted app selection (survives drawer close/reopen and commits)
            const persisted = store.get(persistedAppSelectionAtom)
            if (persisted) {
                setSelectedAppLabel(persisted.appLabel)
                connectApp({
                    appRevisionId: persisted.appRevisionId,
                    appLabel: persisted.appLabel,
                    evaluatorRevisionId: entityId,
                    evaluatorLabel: "Evaluator",
                })
            }

            // Restore the exact testcases that were loaded (same path as TestsetDropdown)
            const persistedTestset = store.get(persistedTestsetSelectionAtom)
            if (persistedTestset?.testcases?.length) {
                const loadableId = store.get(derivedLoadableIdAtom)
                if (loadableId) {
                    store.set(playgroundController.actions.connectToTestset, {
                        loadableId,
                        revisionId: persistedTestset.revisionId,
                        testcases: persistedTestset.testcases,
                        testsetName: persistedTestset.sourceName ?? undefined,
                        testsetId: persistedTestset.testsetId ?? undefined,
                    })
                }
            }
        }
        return () => {
            const store = getDefaultStore()

            // Clear execution results BEFORE resetting nodes
            // (derivedLoadableIdAtom reads from nodes to resolve the loadableId)
            clearAllRuns()

            // Clear loadable rows + state
            const loadableId = store.get(derivedLoadableIdAtom)
            if (loadableId) {
                // Delete all testcase entities
                const rowIds = store.get(testcaseMolecule.atoms.displayRowIds)
                for (const id of rowIds) {
                    store.set(testcaseMolecule.actions.delete, id)
                }
                // Reset loadable state (columns, executionResults, etc.)
                store.set(loadableStateAtomFamily(loadableId), {
                    columns: [],
                    activeRowId: null,
                    connectedSourceId: null,
                    connectedSourceName: null,
                    connectedSourceType: null,
                    linkedRunnableId: null,
                    linkedRunnableType: null,
                    executionResults: {},
                    outputMappings: [],
                    hiddenTestcaseIds: new Set<string>(),
                    disabledOutputMappingRowIds: new Set<string>(),
                    name: null,
                })
            }

            resetAll()
            setInitialized(false)
            setSelectedAppLabel(null)
            setConnectedTestset(null)
        }
    }, [
        entityId,
        addPrimaryNode,
        resetAll,
        clearAllRuns,
        setInitialized,
        setSelectedAppLabel,
        setConnectedTestset,
        connectApp,
    ])

    // Save testset connection to localStorage whenever the user connects a testset
    const connectedTestset = useAtomValue(connectedTestsetAtom)
    useEffect(() => {
        if (!connectedTestset) return
        const store = getDefaultStore()
        const loadableId = store.get(derivedLoadableIdAtom)
        if (!loadableId) return
        const loadableState = store.get(loadableStateAtomFamily(loadableId))
        if (!loadableState.connectedSourceId) return
        const rowIds = store.get(testcaseMolecule.atoms.displayRowIds)
        const testcases = rowIds
            .map((id) => {
                const entity = testcaseMolecule.get.data(id)
                return entity ? ({...entity, id} as {id: string} & Record<string, unknown>) : null
            })
            .filter((t): t is {id: string} & Record<string, unknown> => t !== null)

        setPersistedTestset({
            revisionId: loadableState.connectedSourceId,
            testsetId: connectedTestset.id,
            sourceName: connectedTestset.name ?? null,
            testcases,
        })
    }, [connectedTestset, setPersistedTestset])

    const selectedAppLabel = useAtomValue(selectedAppLabelAtom)

    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const evaluatorNode = useMemo(() => {
        const downstream = nodes.find((n) => n.depth > 0)
        if (downstream) return downstream
        return nodes[0] ?? null
    }, [nodes])

    // Derive from nodes directly (single source of truth, no atom indirection)
    const hasAppConnected = useMemo(() => nodes.some((n) => n.depth > 0), [nodes])
    const configEntityIds = useMemo(() => {
        const downstream = nodes.filter((n) => n.depth > 0)
        if (downstream.length > 0) return downstream.map((n) => n.entityId)
        return nodes.map((n) => n.entityId)
    }, [nodes])

    const appWorkflowAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                skipVariantLevel: true,
                excludeRevisionZero: true,
                flags: {is_evaluator: false, is_feedback: false},
            }),
        [],
    )

    const handleAppSelect = useCallback(
        (selection: WorkflowRevisionSelectionResult) => {
            if (!evaluatorNode) return
            connectApp({
                appRevisionId: selection.id,
                appLabel: selection.label,
                evaluatorRevisionId: evaluatorNode.entityId,
                evaluatorLabel: evaluatorNode.label ?? "Evaluator",
            })
        },
        [connectApp, evaluatorNode],
    )

    const runDisabledContent = useMemo(
        () => (
            <>
                <Typography.Text type="secondary" className="text-sm">
                    Select an app to run the evaluator chain
                </Typography.Text>
                <EntityPicker<WorkflowRevisionSelectionResult>
                    variant="popover-cascader"
                    adapter={appWorkflowAdapter}
                    onSelect={handleAppSelect}
                    size="middle"
                    placeholder={selectedAppLabel ?? "Select app"}
                />
            </>
        ),
        [appWorkflowAdapter, handleAppSelect, selectedAppLabel],
    )

    const providers = useMemo(
        () =>
            ({
                SimpleSharedEditor,
                SharedGenerationResultUtils,
                TestcaseEditor: PlaygroundTestcaseEditor,
            }) as unknown as PlaygroundUIProviders,
        [],
    )

    return (
        <OSSPlaygroundShell providers={providers}>
            <div className="flex flex-col w-full h-full overflow-hidden">
                {isExpanded && (
                    <EvaluatorPlaygroundHeader
                        appWorkflowAdapter={appWorkflowAdapter}
                        onAppSelect={handleAppSelect}
                    />
                )}
                <PlaygroundMainView
                    mode="evaluator"
                    viewMode={isExpanded ? "full" : "configOnly"}
                    embedded
                    configViewMode={configViewMode}
                    onConfigViewModeChange={setConfigViewMode}
                    configEntityIdsOverride={configEntityIds}
                    runDisabled={!hasAppConnected}
                    runDisabledContent={runDisabledContent}
                />
            </div>
        </OSSPlaygroundShell>
    )
})

const DrawerPlayground = memo(({entityId}: {entityId: string}) => {
    const {context} = useAtomValue(workflowRevisionDrawerAtom)
    const isEvaluator = context === "evaluator-view" || context === "evaluator-create"

    return isEvaluator ? (
        <DrawerEvaluatorPlayground entityId={entityId} />
    ) : (
        <DrawerAppPlayground entityId={entityId} />
    )
})

// ================================================================
// COMMIT CALLBACK (evaluator + app create modes)
//
// Fires on commit-success inside the drawer for:
//   - evaluator-create: closes drawer, callback receives new revision ID
//   - evaluator-view:   updates drawer entityId to the newly committed revision
//   - app-create:       closes drawer FIRST (sync atom resets), then callback
//                       receives {newAppId, newRevisionId} so the dropdown
//                       handler can router.push to /apps/<id>/playground.
//                       Order: close → navigate (avoids drawer flicker on
//                       destination page during Next.js async transition).
// ================================================================

const useDrawerCreateCommitCallback = () => {
    const {context} = useAtomValue(workflowRevisionDrawerAtom)
    const drawerCallback = useAtomValue(workflowRevisionDrawerCallbackAtom)
    const drawerCallbackRef = useRef(drawerCallback)
    drawerCallbackRef.current = drawerCallback

    const closeDrawer = useSetAtom(closeWorkflowRevisionDrawerAtom)
    const closeDrawerRef = useRef(closeDrawer)
    closeDrawerRef.current = closeDrawer

    const router = useRouter()
    const routerRef = useRef(router)
    routerRef.current = router

    const {baseAppURL} = useURL()
    const baseAppURLRef = useRef(baseAppURL)
    baseAppURLRef.current = baseAppURL

    const isEvaluator = context === "evaluator-create" || context === "evaluator-view"
    const isEvaluatorCreate = context === "evaluator-create"
    const isAppCreate = context === "app-create"

    useEffect(() => {
        if (!isEvaluator && !isAppCreate) return

        const previousOnNewRevision = getWorkflowCommitCallbacks().onNewRevision

        registerWorkflowCommitCallbacks({
            onNewRevision: async (result, params) => {
                if (isEvaluator) {
                    clearEvaluatorWorkflowCache()
                }
                await previousOnNewRevision?.(result, params)

                if (isEvaluatorCreate) {
                    drawerCallbackRef.current?.({
                        configId: result.newRevisionId,
                        newRevisionId: result.newRevisionId,
                    })
                    closeDrawerRef.current()
                } else if (isAppCreate) {
                    const newWorkflow = result.workflow as
                        | {workflow_id?: string; id?: string}
                        | undefined
                    const newAppId = newWorkflow?.workflow_id ?? newWorkflow?.id ?? undefined
                    const newRevisionId = result.newRevisionId

                    // Refresh the apps-page paginated table + count caches so
                    // the new app shows up immediately on /apps when the user
                    // navigates back. The shared workflow-list invalidation
                    // (commit.ts:590) doesn't cover the app-management
                    // paginated store.
                    void invalidateAppManagementWorkflowQueries()

                    // Fire the user callback first so any analytics/hooks
                    // see the result. Then handle navigation + close inside
                    // the wrapper itself — owning the routing here keeps the
                    // contract simple for callers and avoids brittleness from
                    // a callback closure capturing stale router references.
                    drawerCallbackRef.current?.({
                        newAppId,
                        newRevisionId,
                    })

                    if (newAppId && newRevisionId) {
                        routerRef.current.push(
                            `${baseAppURLRef.current}/${newAppId}/playground?revisions=${newRevisionId}`,
                        )
                    }
                    closeDrawerRef.current()
                } else {
                    // In evaluator-view mode, the selection change callback
                    // skips updating the drawer entity ID (because the drawer
                    // entity intentionally differs from the primary playground
                    // node after app connection). Update it explicitly here
                    // so the drawer displays the newly committed revision.
                    const store = getDefaultStore()
                    store.set(workflowRevisionDrawerEntityIdAtom, result.newRevisionId)
                }

                message.success(
                    isAppCreate
                        ? "App created successfully"
                        : isEvaluatorCreate
                          ? "Evaluator created successfully"
                          : "Evaluator committed successfully",
                )
            },
        })

        return () => {
            registerWorkflowCommitCallbacks({
                onNewRevision: previousOnNewRevision,
            })
        }
    }, [isEvaluator, isEvaluatorCreate, isAppCreate])
}

// ================================================================
// MAIN WRAPPER
// ================================================================

// ================================================================
// CROSS-CONTEXT CLEANUP — release local-* on close (idle, no commit)
//
// Wires `closeWorkflowRevisionDrawerAtom` to also dispatch
// `discardLocalServerDataAtom` for any local-* entity. Applies to all
// drawer-create contexts (app-create, evaluator-create, trace-replay).
//
// Commit-in-flight gate: if a commit just succeeded, the close was
// triggered BY the commit handler (above), and the entity has already
// been promoted to a real ID. Releasing the local-* entry then is
// safe — the new real entity is in a different atom family.
//
// If a commit is in-flight at the moment of close (e.g., user clicks
// the X mid-commit), the existing close-handler runs synchronously
// before the commit settles. Acceptable for v1: the commit will still
// complete on the server and the user can find the new app in the
// list. The orphan local-* would be cleared by the close, but the
// commit's discardWorkflowDraftAtom call already clears the draft
// layer; the local server data is dead either way.
// ================================================================

const useDrawerCloseCleanup = () => {
    const isOpen = useAtomValue(workflowRevisionDrawerOpenAtom)
    const entityIdRef = useRef<string | null>(null)
    const entityId = useAtomValue(workflowRevisionDrawerEntityIdAtom)
    entityIdRef.current = entityId

    const discard = useSetAtom(discardLocalServerDataAtom)
    const discardRef = useRef(discard)
    discardRef.current = discard

    const prevOpenRef = useRef(isOpen)
    useEffect(() => {
        if (prevOpenRef.current && !isOpen) {
            // Drawer just closed — release the entity that was open.
            // Read from the ref captured BEFORE the close (since close
            // resets entityId to null).
            const id = entityIdRef.current
            if (id) discardRef.current(id)
        }
        prevOpenRef.current = isOpen
    }, [isOpen])
}

// ================================================================
// REFRESH WARNING — beforeunload guard for unsaved drawer edits
//
// Fires the standard browser "you have unsaved changes" warning when
// the user tries to refresh / close tab while a drawer-create context
// is open AND the entity has unsaved edits. Cross-context: covers
// app-create, evaluator-create, trace-replay.
// ================================================================

const useUnsavedDrawerWarning = () => {
    const isOpen = useAtomValue(workflowRevisionDrawerOpenAtom)
    const context = useAtomValue(workflowRevisionDrawerContextAtom)
    const entityId = useAtomValue(workflowRevisionDrawerEntityIdAtom)
    const isDirty = useAtomValue(
        useMemo(() => workflowMolecule.atoms.isDirty(entityId ?? "__none__"), [entityId]),
    )

    useEffect(() => {
        if (!isOpen || !isCreateContext(context) || !isDirty) return
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            // Modern browsers ignore the message, but setting returnValue
            // is required to trigger the prompt at all.
            e.returnValue = ""
        }
        window.addEventListener("beforeunload", handler)
        return () => window.removeEventListener("beforeunload", handler)
    }, [isOpen, context, isDirty])
}

const WorkflowRevisionDrawerWrapper = () => {
    const isOpen = useAtomValue(workflowRevisionDrawerOpenAtom)
    const entityId = useAtomValue(workflowRevisionDrawerEntityIdAtom)
    const [, setQueryRevision] = useQueryParamState("revisionId")

    useDrawerCreateCommitCallback()
    useDrawerCloseCleanup()
    useUnsavedDrawerWarning()

    // Clear revisionId from URL when drawer closes
    const prevOpenRef = useRef(isOpen)
    useEffect(() => {
        if (prevOpenRef.current && !isOpen) {
            setQueryRevision(null, {shallow: true})
        }
        prevOpenRef.current = isOpen
    }, [isOpen, setQueryRevision])

    // Update URL when prev/next navigation occurs.
    const setQueryRevisionRef = useRef(setQueryRevision)
    setQueryRevisionRef.current = setQueryRevision

    const handleNavigate = useCallback((newEntityId: string) => {
        setQueryRevisionRef.current(newEntityId, {shallow: true})
    }, [])

    const providers = useMemo<DrawerProviders>(
        () => ({
            PlaygroundConfigSection,
            onNavigate: handleNavigate,
            VariantNameCell: ({revisionId, showBadges}) => (
                <VariantNameCell revisionId={revisionId} showBadges={showBadges} />
            ),
            DrillInUIProvider: OSSdrillInUIProvider,
            renderPlaygroundButton: (revisionId) => <PlaygroundButton revisionId={revisionId} />,
            renderDeployButton: (revisionId) => (
                <DeployVariantButton
                    label="Deploy"
                    type="default"
                    size="small"
                    revisionId={revisionId}
                />
            ),
            renderCommitButton: (revisionId, options) => (
                <CommitVariantChangesButton
                    variantId={revisionId}
                    label="Commit"
                    type="default"
                    size="small"
                    onSuccess={options?.onSuccess}
                />
            ),
            renderEnvironmentLabel: (envName) => (
                <EnvironmentTag key={envName} environment={envName} />
            ),
            renderEvaluatorTypeLabel: (revisionId) => (
                <EvaluatorTypeLabel revisionId={revisionId} />
            ),
            renderVariantDetails: ({name, version, variant}) => (
                <VariantDetailsWithStatus
                    variantName={name}
                    revision={version}
                    variant={variant as any}
                />
            ),
        }),
        [],
    )

    // The drawer content IS the playground — mounted once, viewMode toggles on expand
    const playgroundContent =
        isOpen && entityId ? <DrawerPlayground entityId={entityId} /> : undefined

    return (
        <DrawerProvidersProvider providers={providers}>
            <WorkflowRevisionDrawer playgroundContent={playgroundContent} />
            <HumanEvaluatorDrawer />
        </DrawerProvidersProvider>
    )
}

export default memo(WorkflowRevisionDrawerWrapper)
