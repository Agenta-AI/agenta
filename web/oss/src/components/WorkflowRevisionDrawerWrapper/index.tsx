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
import {memo, useCallback, useEffect, useMemo, useRef, type ReactNode} from "react"

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
import {PlaygroundConfigSection} from "@agenta/entity-ui/drill-in"
import {VariantDetailsWithStatus, VariantNameCell} from "@agenta/entity-ui/variant"
import {playgroundController} from "@agenta/playground"
import {
    clearAllRunsMutationAtom,
    connectedTestsetAtom,
    derivedLoadableIdAtom,
    executionAdapterAtom,
    playgroundInitializedAtom,
    playgroundStoreAtom,
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
    workflowRevisionDrawerInitialAppSelectionAtom,
    workflowRevisionDrawerIsolatedPlaygroundAtom,
    workflowRevisionDrawerOpenAtom,
    workflowRevisionDrawerPostCreateNavigationAtom,
    workflowRevisionDrawerScopedDirtyAtom,
    workflowRevisionDrawerViewModeAtom,
    WorkflowRevisionDrawer,
    suppressDrawerCloseUrlCleanupAtom,
    type DrawerProviders,
    type DrawerInitialAppSelection,
} from "@agenta/playground-ui/workflow-revision-drawer"
import {projectIdAtom, sessionAtom} from "@agenta/shared/state"
import {EnvironmentTag} from "@agenta/ui"
import {Rocket} from "@phosphor-icons/react"
import {Button, message} from "antd"
import {
    Provider,
    createStore,
    getDefaultStore,
    useAtom,
    useAtomValue,
    useSetAtom,
    useStore,
    type PrimitiveAtom,
} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {AgentChatScopeProvider, drawerScopeKey} from "@/oss/components/AgentChatSlice/state/scope"
import OSSdrillInUIProvider from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {
    connectAppToEvaluatorAtom,
    persistedAppSelectionAtom,
    persistedTestsetSelectionAtom,
} from "@/oss/components/Evaluators/components/ConfigureEvaluator/atoms"
import EvaluatorPlaygroundHeader from "@/oss/components/Evaluators/components/ConfigureEvaluator/EvaluatorPlaygroundHeader"
import SelectAppEmptyState from "@/oss/components/Evaluators/components/ConfigureEvaluator/SelectAppEmptyState"
import {useEvaluatorRunControls} from "@/oss/components/Evaluators/components/ConfigureEvaluator/useEvaluatorRunControls"
import {clearEvaluatorWorkflowCache} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import {invalidateAgentsWorkflowQueries} from "@/oss/components/pages/agents/store"
import {invalidateAppManagementWorkflowQueries} from "@/oss/components/pages/app-management/store"
import {invalidatePromptsWorkflowQueries} from "@/oss/components/pages/prompts/store"
import CommitVariantChangesButton from "@/oss/components/Playground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
import DeployVariantButton from "@/oss/components/Playground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"
import PlaygroundTestcaseEditor from "@/oss/components/Playground/Components/PlaygroundTestcaseEditor"
import WebWorkerProvider from "@/oss/components/Playground/Components/WebWorkerProvider"
import {OSSPlaygroundShell} from "@/oss/components/Playground/OSSPlaygroundShell"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import useURL from "@/oss/hooks/useURL"
import {useQueryParamState} from "@/oss/state/appState"
import {EVALUATOR_FULL_PAGE_NAV_ENABLED} from "@/oss/state/workflow"

const PlaygroundMainView = dynamic(
    () => import("@/oss/components/Playground/Components/MainLayout"),
    {ssr: false},
)

// Agent generation arm, same surface the full playground injects. Without this the app drawer
// renders nothing for an agent entity (the generations panel does `AgentGenerationPanel ?? null`),
// so a freshly-created agent can't be invoked from the create/edit drawer the way chat and
// completion can. Lazy — pulls in the AI SDK only when an agent workflow is open.
const AgentChatPanel = dynamic(() => import("@/oss/components/AgentChatSlice/AgentChatPanel"), {
    ssr: false,
})

// Drawer agent chat runs in its OWN session scope so it never inherits or overwrites the main
// playground's tabs/history. The drawer mounts over the playground, so both AgentChatPanels are
// live at once; a shared (app) scope would have them share conversations. See
// AgentChatSlice/state/scope.
const ScopedDrawerAgentChat = (props: {entityId: string}) => (
    <AgentChatScopeProvider scopeKey={drawerScopeKey(props.entityId)}>
        <AgentChatPanel {...props} />
    </AgentChatScopeProvider>
)

const TestsetDropdown = dynamic(
    () => import("@/oss/components/Playground/Components/TestsetDropdown"),
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
                // Agent entities render the agent-chat surface here too, so the create/edit drawer
                // can invoke an agent the same way it invokes chat/completion.
                AgentGenerationPanel: ScopedDrawerAgentChat,
            }) as unknown as PlaygroundUIProviders,
        [],
    )

    const renderTestsetActions = useCallback(() => <TestsetDropdown />, [])

    return (
        <OSSPlaygroundShell providers={providers}>
            <PlaygroundMainView
                mode="app"
                viewMode={isExpanded ? "full" : "configOnly"}
                embedded
                configViewMode={configViewMode}
                onConfigViewModeChange={setConfigViewMode}
                renderTestsetActions={renderTestsetActions}
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
const DrawerEvaluatorPlayground = memo(function DrawerEvaluatorPlayground({
    entityId,
    isExpanded,
    configViewMode,
    onConfigViewModeChange,
    onScopedDirtyChange,
    initialAppSelection,
}: {
    entityId: string
    isExpanded: boolean
    configViewMode: "form" | "json" | "yaml"
    onConfigViewModeChange: (mode: "form" | "json" | "yaml") => void
    onScopedDirtyChange?: (isDirty: boolean) => void
    initialAppSelection?: DrawerInitialAppSelection | null
}) {
    const store = useStore()
    const isDirty = useAtomValue(
        useMemo(() => workflowMolecule.atoms.isDirty(entityId), [entityId]),
    )

    useEffect(() => {
        onScopedDirtyChange?.(isDirty)
        return () => onScopedDirtyChange?.(false)
    }, [isDirty, onScopedDirtyChange])

    // Initialize playground with the evaluator entity via addPrimaryNode
    // (same path as playgroundSyncAtom). This properly links the loadable,
    // creates initial testcase rows, and sets up the local testset.
    const addPrimaryNode = useSetAtom(playgroundController.actions.addPrimaryNode)
    const resetAll = useSetAtom(playgroundController.actions.resetAll)
    const clearAllRuns = useSetAtom(clearAllRunsMutationAtom)
    const setInitialized = useSetAtom(playgroundInitializedAtom)
    const setConnectedTestset = useSetAtom(connectedTestsetAtom)
    const connectApp = useSetAtom(connectAppToEvaluatorAtom)
    const setPersistedTestset = useSetAtom(persistedTestsetSelectionAtom)
    useEffect(() => {
        if (entityId) {
            addPrimaryNode({type: "workflow", id: entityId, label: "Evaluator"})
            setInitialized(true)

            // Prefer the caller's current app revision, then fall back to the
            // persisted evaluator selection used by existing entry points.
            // `selectedAppLabelAtom` is derived from the node graph now — the
            // `connectApp` call below seeds the depth-0 node with the selected
            // label, which the derived atom picks up automatically.
            const persistedAppSelection = store.get(persistedAppSelectionAtom)
            const appSelection = initialAppSelection
                ? {
                      appRevisionId: initialAppSelection.revisionId,
                      appLabel: initialAppSelection.label,
                  }
                : persistedAppSelection
            if (appSelection) {
                connectApp({
                    appRevisionId: appSelection.appRevisionId,
                    appLabel: appSelection.appLabel,
                    evaluatorRevisionId: entityId,
                    evaluatorLabel: "Evaluator",
                    persistSelection: !initialAppSelection,
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
            // `selectedAppLabelAtom` is derived from the node graph — `resetAll`
            // above clears the nodes, which flips the label back to `null`.
            setConnectedTestset(null)
        }
    }, [
        entityId,
        addPrimaryNode,
        resetAll,
        clearAllRuns,
        setInitialized,
        setConnectedTestset,
        connectApp,
        initialAppSelection,
    ])

    // Save testset connection to localStorage whenever the user connects a testset
    const connectedTestset = useAtomValue(connectedTestsetAtom)
    useEffect(() => {
        if (!connectedTestset) return
        const loadableId = store.get(derivedLoadableIdAtom)
        if (!loadableId) return
        const loadableState = store.get(loadableStateAtomFamily(loadableId))
        if (!loadableState.connectedSourceId) return
        const rowIds = store.get(testcaseMolecule.atoms.displayRowIds)
        const testcases = rowIds
            .map((id) => {
                const entity = store.get(testcaseMolecule.data(id))
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

    // Shared run controls — the same hook the full page and the creation drawer
    // use, so every evaluator surface gates runs identically (run-on aware) and
    // can't drift apart again. (This drawer previously hardcoded
    // `runDisabled={!hasAppConnected}`, which ignored the run-on mode and forced
    // an app even in test-case mode.)
    const {appWorkflowAdapter, handleAppSelect, selectedAppLabel, runDisabled} =
        useEvaluatorRunControls()

    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const configEntityIds = useMemo(() => {
        const downstream = nodes.filter((n) => n.depth > 0)
        if (downstream.length > 0) return downstream.map((n) => n.entityId)
        return nodes.map((n) => n.entityId)
    }, [nodes])

    const runDisabledContent = useMemo(
        () => (
            <SelectAppEmptyState
                adapter={appWorkflowAdapter}
                onSelect={handleAppSelect}
                selectedAppLabel={selectedAppLabel}
            />
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
                {isExpanded && <EvaluatorPlaygroundHeader />}
                <PlaygroundMainView
                    mode="evaluator"
                    viewMode={isExpanded ? "full" : "configOnly"}
                    embedded
                    configViewMode={configViewMode}
                    onConfigViewModeChange={onConfigViewModeChange}
                    configEntityIdsOverride={configEntityIds}
                    runDisabled={runDisabled}
                    runDisabledContent={runDisabledContent}
                />
            </div>
        </OSSPlaygroundShell>
    )
})

const DrawerPlayground = memo(({entityId}: {entityId: string}) => {
    const {context} = useAtomValue(workflowRevisionDrawerAtom)
    const isolatedPlayground = useAtomValue(workflowRevisionDrawerIsolatedPlaygroundAtom)
    const initialAppSelection = useAtomValue(workflowRevisionDrawerInitialAppSelectionAtom)
    const isExpanded = useAtomValue(workflowRevisionDrawerExpandedAtom)
    const [configViewMode, setConfigViewMode] = useAtom(workflowRevisionDrawerViewModeAtom)
    const setScopedDirty = useSetAtom(workflowRevisionDrawerScopedDirtyAtom)
    const isEvaluator = context === "evaluator-view" || context === "evaluator-create"

    if (!isEvaluator) return <DrawerAppPlayground entityId={entityId} />

    const evaluatorPlayground = (
        <DrawerEvaluatorPlayground
            entityId={entityId}
            isExpanded={isExpanded}
            configViewMode={configViewMode}
            onConfigViewModeChange={setConfigViewMode}
            onScopedDirtyChange={isolatedPlayground ? setScopedDirty : undefined}
            initialAppSelection={initialAppSelection}
        />
    )

    return isolatedPlayground ? (
        <IsolatedDrawerPlaygroundSession
            entityId={entityId}
            initialAppSelection={initialAppSelection}
        >
            {evaluatorPlayground}
        </IsolatedDrawerPlaygroundSession>
    ) : (
        evaluatorPlayground
    )
})

const IsolatedDrawerPlaygroundSession = ({
    entityId,
    initialAppSelection,
    children,
}: {
    entityId: string
    initialAppSelection?: DrawerInitialAppSelection | null
    children: ReactNode
}) => {
    const parentStore = useStore()
    const scopedStore = useMemo(() => {
        const store = createStore()
        store.set(playgroundStoreAtom, store)
        store.set(projectIdAtom, parentStore.get(projectIdAtom))
        store.set(sessionAtom, parentStore.get(sessionAtom))
        store.set(queryClientAtom, parentStore.get(queryClientAtom))
        store.set(executionAdapterAtom, parentStore.get(executionAdapterAtom))

        const entity = parentStore.get(workflowMolecule.selectors.data(entityId))
        if (entity) {
            workflowMolecule.set.seedEntity(entityId, entity, {store})
        }

        if (initialAppSelection) {
            const appEntity = parentStore.get(
                workflowMolecule.selectors.data(initialAppSelection.revisionId),
            )
            if (appEntity) {
                workflowMolecule.set.seedEntity(initialAppSelection.revisionId, appEntity, {store})
            }
        }

        return store
    }, [entityId, initialAppSelection, parentStore])

    useEffect(() => {
        const mirrorAtom = <Value,>(targetAtom: PrimitiveAtom<Value>) =>
            parentStore.sub(targetAtom, () => {
                scopedStore.set(targetAtom, parentStore.get(targetAtom))
            })
        const unsubs = [
            mirrorAtom(projectIdAtom),
            mirrorAtom(sessionAtom),
            mirrorAtom(queryClientAtom),
            mirrorAtom(executionAdapterAtom),
        ]
        return () => unsubs.forEach((unsubscribe) => unsubscribe())
    }, [parentStore, scopedStore])

    return (
        <Provider store={scopedStore}>
            <WebWorkerProvider>{children}</WebWorkerProvider>
        </Provider>
    )
}

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
    const isolatedPlayground = useAtomValue(workflowRevisionDrawerIsolatedPlaygroundAtom)
    const postCreateNavigation = useAtomValue(workflowRevisionDrawerPostCreateNavigationAtom)
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
                if (!isolatedPlayground) {
                    await previousOnNewRevision?.(result, params)
                }

                if (isEvaluatorCreate) {
                    const newWorkflow = result.workflow as
                        | {
                              workflow_id?: string
                              id?: string
                              slug?: string
                              flags?: Record<string, unknown> | null
                              data?: {uri?: string | null} | null
                              meta?: Record<string, unknown> | null
                          }
                        | undefined
                    const newAppId = newWorkflow?.workflow_id ?? newWorkflow?.id ?? undefined
                    const newRevisionId = result.newRevisionId

                    drawerCallbackRef.current?.({
                        configId: newRevisionId,
                        newAppId,
                        newRevisionId,
                        workflow: result.workflow,
                    })

                    message.success("Evaluator created successfully")

                    if (postCreateNavigation === "stay") {
                        closeDrawerRef.current()
                        return
                    }

                    // Close the drawer immediately and fire-and-forget the
                    // navigation. We pass `skipUrlCleanup: true` so the
                    // drawer-close effect doesn't run `setQueryRevision(null)`
                    // against the stale pathname — that race would cancel the
                    // in-flight `router.push` to the new playground.
                    //
                    // (`Router.pathname` only flips on `routeChangeComplete`,
                    // so a synchronous close after `router.push` would patch
                    // the still-current `/evaluators` URL and push back to it.)
                    //
                    // Gated by `EVALUATOR_FULL_PAGE_NAV_ENABLED`: while the
                    // flag is off, post-create stays in the drawer flow. When
                    // on, every freshly committed evaluator (regardless of
                    // template type) lands on `/apps/<id>/playground` —
                    // mirroring app-create's post-commit navigation. The
                    // earlier classifier-only gate was removed so declarative
                    // evaluators get the same surface (variants, traces,
                    // sidebar context) as LLM/code ones.
                    const eligibleForPlayground = Boolean(
                        EVALUATOR_FULL_PAGE_NAV_ENABLED && newAppId && newRevisionId,
                    )

                    if (eligibleForPlayground && newAppId && newRevisionId) {
                        const url = `${baseAppURLRef.current}/${encodeURIComponent(
                            newAppId,
                        )}/playground?revisions=${encodeURIComponent(newRevisionId)}`
                        closeDrawerRef.current({skipUrlCleanup: true})
                        void routerRef.current.push(url).catch((err) => {
                            console.error("[evaluator-create] router.push failed", err)
                        })
                    } else {
                        closeDrawerRef.current()
                    }
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
                    void invalidateAgentsWorkflowQueries()

                    // Same problem on the Prompts page: it reads its own
                    // ["prompts-workflows"] query, which neither the shared
                    // invalidation nor the app-management one touches. Without
                    // this the new prompt is missing from the list until a
                    // manual reload.
                    void invalidatePromptsWorkflowQueries()

                    drawerCallbackRef.current?.({
                        newAppId,
                        newRevisionId,
                    })

                    message.success("App created successfully")

                    // Close immediately and fire-and-forget navigation. See
                    // the evaluator-create branch above for why we use
                    // `skipUrlCleanup` instead of awaiting `router.push`.
                    if (newAppId && newRevisionId) {
                        closeDrawerRef.current({skipUrlCleanup: true})
                        void routerRef.current
                            .push(
                                `${baseAppURLRef.current}/${newAppId}/playground?revisions=${newRevisionId}`,
                            )
                            .catch((err) => {
                                console.error("[app-create] router.push failed", err)
                            })
                    } else {
                        closeDrawerRef.current()
                    }
                } else {
                    // In evaluator-view mode, the selection change callback
                    // skips updating the drawer entity ID (because the drawer
                    // entity intentionally differs from the primary playground
                    // node after app connection). Update it explicitly here
                    // so the drawer displays the newly committed revision.
                    const store = getDefaultStore()
                    store.set(workflowRevisionDrawerEntityIdAtom, result.newRevisionId)
                    message.success("Evaluator committed successfully")
                }
            },
        })

        return () => {
            registerWorkflowCommitCallbacks({
                onNewRevision: previousOnNewRevision,
            })
        }
    }, [isEvaluator, isEvaluatorCreate, isAppCreate, isolatedPlayground, postCreateNavigation])
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

    // `closeWorkflowRevisionDrawerAtom` resets `isOpen` and `entityId`
    // atomically in one Jotai write. React batches both updates into the
    // same render, so a naive `entityIdRef.current = entityId` during
    // render would clobber the ref with `null` BEFORE the cleanup effect
    // fires. Only update the ref while the drawer is open, so we keep
    // the last truthy ID around to discard on close.
    if (isOpen && entityId && entityIdRef.current !== entityId) {
        entityIdRef.current = entityId
    }

    const discard = useSetAtom(discardLocalServerDataAtom)
    const discardRef = useRef(discard)
    discardRef.current = discard

    const prevOpenRef = useRef(isOpen)
    useEffect(() => {
        if (prevOpenRef.current && !isOpen) {
            // Drawer just closed — release the entity that was open.
            // Read from the ref captured BEFORE the close (since close
            // resets entityId to null in the same render).
            const id = entityIdRef.current
            if (id) discardRef.current(id)
            entityIdRef.current = null
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
    const isolatedPlayground = useAtomValue(workflowRevisionDrawerIsolatedPlaygroundAtom)
    const scopedDirty = useAtomValue(workflowRevisionDrawerScopedDirtyAtom)
    const isDirty = useAtomValue(
        useMemo(() => workflowMolecule.atoms.isDirty(entityId ?? "__none__"), [entityId]),
    )
    const effectiveDirty = isolatedPlayground ? scopedDirty : isDirty

    useEffect(() => {
        if (!isOpen || !isCreateContext(context) || !effectiveDirty) return
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault()
            // Modern browsers ignore the message, but setting returnValue
            // is required to trigger the prompt at all.
            e.returnValue = ""
        }
        window.addEventListener("beforeunload", handler)
        return () => window.removeEventListener("beforeunload", handler)
    }, [isOpen, context, effectiveDirty])
}

const WorkflowRevisionDrawerWrapper = () => {
    const isOpen = useAtomValue(workflowRevisionDrawerOpenAtom)
    const entityId = useAtomValue(workflowRevisionDrawerEntityIdAtom)
    const [, setQueryRevision] = useQueryParamState("revisionId")

    useDrawerCreateCommitCallback()
    useDrawerCloseCleanup()
    useUnsavedDrawerWarning()

    // Clear revisionId from URL when drawer closes.
    //
    // When `closeWorkflowRevisionDrawerAtom` is invoked with
    // `{skipUrlCleanup: true}` (e.g. from the create-callbacks immediately
    // before kicking off `router.push` to a different page), skip this
    // cleanup. Otherwise the cleanup runs against the still-stale pathname
    // (`Router.pathname` only flips on `routeChangeComplete`), rebuilds the
    // current URL without `revisionId`, and pushes it — which cancels the
    // in-flight navigation to the new playground.
    const [suppressUrlCleanup, setSuppressUrlCleanup] = useAtom(suppressDrawerCloseUrlCleanupAtom)
    const prevOpenRef = useRef(isOpen)
    useEffect(() => {
        if (prevOpenRef.current && !isOpen) {
            if (!suppressUrlCleanup) {
                setQueryRevision(null, {shallow: true})
            }
            setSuppressUrlCleanup(false)
        }
        prevOpenRef.current = isOpen
    }, [isOpen, setQueryRevision, suppressUrlCleanup, setSuppressUrlCleanup])

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
