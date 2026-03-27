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

import {
    registerWorkflowCommitCallbacks,
    getWorkflowCommitCallbacks,
    parseEvaluatorKeyFromUri,
    evaluatorTemplatesMapAtom,
    workflowMolecule,
} from "@agenta/entities/workflow"
import {EntityPicker} from "@agenta/entity-ui"
import {PlaygroundConfigSection} from "@agenta/entity-ui/drill-in"
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {VariantDetailsWithStatus, VariantNameCell} from "@agenta/entity-ui/variant"
import {playgroundController} from "@agenta/playground"
import {type PlaygroundUIProviders} from "@agenta/playground-ui"
import {
    DrawerProvidersProvider,
    workflowRevisionDrawerAtom,
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
import {Button, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import OSSdrillInUIProvider from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import {
    connectAppToEvaluatorAtom,
    evaluatorConfigEntityIdsAtom,
    hasAppConnectedAtom,
    selectedAppLabelAtom,
} from "@/oss/components/Evaluators/components/ConfigureEvaluator/atoms"
import EvaluatorPlaygroundHeader from "@/oss/components/Evaluators/components/ConfigureEvaluator/EvaluatorPlaygroundHeader"
import {clearEvaluatorWorkflowCache} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import CommitVariantChangesButton from "@/oss/components/Playground/Components/Modals/CommitVariantChangesModal/assets/CommitVariantChangesButton"
import DeployVariantButton from "@/oss/components/Playground/Components/Modals/DeployVariantModal/assets/DeployVariantButton"
import PlaygroundTestcaseEditor from "@/oss/components/Playground/Components/PlaygroundTestcaseEditor"
import {OSSPlaygroundShell} from "@/oss/components/Playground/OSSPlaygroundShell"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
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

const DrawerPlayground = memo(({entityId}: {entityId: string}) => {
    const {context} = useAtomValue(workflowRevisionDrawerAtom)
    const isExpanded = useAtomValue(workflowRevisionDrawerExpandedAtom)
    const [configViewMode, setConfigViewMode] = useAtom(workflowRevisionDrawerViewModeAtom)

    const isEvaluator = context === "evaluator-view" || context === "evaluator-create"

    // Set up playground entity IDs
    const setEntityIds = useSetAtom(playgroundController.actions.setEntityIds)
    useEffect(() => {
        if (entityId) {
            setEntityIds([entityId])
        }
        return () => {
            setEntityIds([])
        }
    }, [entityId, setEntityIds])

    // Evaluator playground: app selector + connect logic
    const configEntityIds = useAtomValue(evaluatorConfigEntityIdsAtom)
    const hasAppConnected = useAtomValue(hasAppConnectedAtom)
    const connectApp = useSetAtom(connectAppToEvaluatorAtom)
    const selectedAppLabel = useAtomValue(selectedAppLabelAtom)

    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const evaluatorNode = useMemo(() => {
        const downstream = nodes.find((n) => n.depth > 0)
        if (downstream) return downstream
        return nodes[0] ?? null
    }, [nodes])

    const appWorkflowAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                skipVariantLevel: true,
                excludeRevisionZero: true,
                flags: {is_evaluator: false, is_human: false},
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
                {isEvaluator && isExpanded && (
                    <EvaluatorPlaygroundHeader
                        appWorkflowAdapter={appWorkflowAdapter}
                        onAppSelect={handleAppSelect}
                    />
                )}
                <PlaygroundMainView
                    mode={isEvaluator ? "evaluator" : "app"}
                    viewMode={isExpanded ? "full" : "configOnly"}
                    embedded
                    configViewMode={configViewMode}
                    onConfigViewModeChange={setConfigViewMode}
                    configEntityIdsOverride={isEvaluator ? configEntityIds : undefined}
                    runDisabled={isEvaluator && !hasAppConnected}
                    runDisabledContent={isEvaluator ? runDisabledContent : undefined}
                />
            </div>
        </OSSPlaygroundShell>
    )
})

// ================================================================
// COMMIT CALLBACK (evaluator create mode)
// ================================================================

const useEvaluatorCommitCallback = () => {
    const {context} = useAtomValue(workflowRevisionDrawerAtom)
    const drawerCallback = useAtomValue(workflowRevisionDrawerCallbackAtom)
    const drawerCallbackRef = useRef(drawerCallback)
    drawerCallbackRef.current = drawerCallback

    const isEvaluatorCreate = context === "evaluator-create"

    useEffect(() => {
        if (!isEvaluatorCreate) return

        const previousOnNewRevision = getWorkflowCommitCallbacks().onNewRevision

        registerWorkflowCommitCallbacks({
            onNewRevision: async (result, params) => {
                clearEvaluatorWorkflowCache()
                await previousOnNewRevision?.(result, params)
                drawerCallbackRef.current?.(result.newRevisionId)
            },
        })

        return () => {
            registerWorkflowCommitCallbacks({
                onNewRevision: previousOnNewRevision,
            })
        }
    }, [isEvaluatorCreate])
}

// ================================================================
// MAIN WRAPPER
// ================================================================

const WorkflowRevisionDrawerWrapper = () => {
    const isOpen = useAtomValue(workflowRevisionDrawerOpenAtom)
    const entityId = useAtomValue(workflowRevisionDrawerEntityIdAtom)
    const [, setQueryRevision] = useQueryParamState("revisionId")

    useEvaluatorCommitCallback()

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
