/**
 * CreateEvaluatorDrawer
 *
 * An inline drawer for evaluator creation within the NewEvaluation modal.
 * Embeds the playground infrastructure matching the evaluator playground page behavior:
 *
 * Phase 1: Evaluator is primary node → config panel only, run disabled with app picker
 * Phase 2: App selected → app becomes primary, evaluator moves downstream, run enabled
 *
 * Flow:
 * 1. Template selected → local entity created → drawer opens with entity ID
 * 2. Playground renders with same two-phase model as evaluator playground page
 * 3. User can expand drawer to show execution panel (full mode)
 * 4. On commit → drawer closes → onEvaluatorCreated(newRevisionId)
 */
import {memo, useCallback, useEffect, useMemo, useRef} from "react"

import {
    workflowMolecule,
    registerWorkflowCommitCallbacks,
    getWorkflowCommitCallbacks,
} from "@agenta/entities/workflow"
import {EntityPicker} from "@agenta/entity-ui"
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {PlaygroundUIProvider, type PlaygroundUIProviders} from "@agenta/playground-ui"
import {EntitySelectorProvider} from "@agenta/playground-ui/components"
import {ArrowsIn, ArrowsOut} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {OSSdrillInUIProvider} from "@/oss/components/DrillInView/OSSdrillInUIProvider"
import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {
    connectAppToEvaluatorAtom,
    evaluatorConfigEntityIdsAtom,
    hasAppConnectedAtom,
    selectedAppLabelAtom,
} from "@/oss/components/Evaluators/components/ConfigureEvaluator/atoms"
import {clearEvaluatorWorkflowNameCache} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import PlaygroundTestcaseEditor from "@/oss/components/Playground/Components/PlaygroundTestcaseEditor"
import {OSSPlaygroundEntityProvider} from "@/oss/components/Playground/OSSPlaygroundEntityProvider"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"

import {closeDrawerAtom, drawerEntityIdAtom, drawerExpandedAtom, drawerOpenAtom} from "./state"

const PlaygroundMainView = dynamic(
    () => import("@/oss/components/Playground/Components/MainLayout"),
    {ssr: false},
)

const TestsetDropdown = dynamic(
    () => import("@/oss/components/Playground/Components/TestsetDropdown"),
    {ssr: false},
)

interface CreateEvaluatorDrawerProps {
    /** Callback after successful evaluator creation. Called with the new revision ID. */
    onEvaluatorCreated?: (configId?: string) => void
}

const DrawerHeader = ({entityId, onClose}: {entityId: string; onClose: () => void}) => {
    const isExpanded = useAtomValue(drawerExpandedAtom)
    const setExpanded = useSetAtom(drawerExpandedAtom)
    const entityData = useAtomValue(
        useMemo(() => workflowMolecule.selectors.data(entityId), [entityId]),
    )
    const name = entityData?.name?.trim() || entityData?.slug?.trim() || "New Evaluator"

    const hasAppConnected = useAtomValue(hasAppConnectedAtom)
    const selectedAppLabel = useAtomValue(selectedAppLabelAtom)
    const connectApp = useSetAtom(connectAppToEvaluatorAtom)

    // Read current evaluator node (same logic as evaluator playground page)
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

    return (
        <div className="flex items-center justify-between px-4 py-3 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
            <Typography.Text className="text-base font-semibold">{name}</Typography.Text>
            <div className="flex items-center gap-2">
                <EntityPicker<WorkflowRevisionSelectionResult>
                    variant="popover-cascader"
                    adapter={appWorkflowAdapter}
                    onSelect={handleAppSelect}
                    size="small"
                    placeholder={selectedAppLabel ?? "Select app"}
                />
                {hasAppConnected && <TestsetDropdown />}
                <Button
                    type="text"
                    size="small"
                    icon={isExpanded ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}
                    onClick={() => setExpanded(!isExpanded)}
                />
                <Button type="text" size="small" onClick={onClose}>
                    Close
                </Button>
            </div>
        </div>
    )
}

const DrawerContent = ({
    entityId,
    onClose,
    onEvaluatorCreated,
}: {
    entityId: string
    onClose: () => void
    onEvaluatorCreated?: (configId?: string) => void
}) => {
    const isExpanded = useAtomValue(drawerExpandedAtom)
    const hasAppConnected = useAtomValue(hasAppConnectedAtom)
    const configEntityIds = useAtomValue(evaluatorConfigEntityIdsAtom)
    const connectApp = useSetAtom(connectAppToEvaluatorAtom)
    const selectedAppLabel = useAtomValue(selectedAppLabelAtom)
    const onEvaluatorCreatedRef = useRef(onEvaluatorCreated)
    onEvaluatorCreatedRef.current = onEvaluatorCreated

    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    // Register commit callback to intercept the new revision ID.
    // Chain with any existing onNewRevision (e.g., from workflowEntityBridge)
    // and restore the previous handler on cleanup.
    useEffect(() => {
        const previousOnNewRevision = getWorkflowCommitCallbacks().onNewRevision

        registerWorkflowCommitCallbacks({
            onNewRevision: async (result, params) => {
                clearEvaluatorWorkflowNameCache()
                await previousOnNewRevision?.(result, params)
                onCloseRef.current()
                onEvaluatorCreatedRef.current?.(result.newRevisionId)
            },
        })

        return () => {
            registerWorkflowCommitCallbacks({
                onNewRevision: previousOnNewRevision,
            })
        }
    }, [])

    // Read current evaluator node for app selection
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
        <OSSPlaygroundEntityProvider>
            <PlaygroundUIProvider providers={providers}>
                <EntitySelectorProvider>
                    <OSSdrillInUIProvider>
                        <div className="flex flex-col w-full h-full overflow-hidden">
                            <DrawerHeader entityId={entityId} onClose={onClose} />
                            <PlaygroundMainView
                                mode="evaluator"
                                viewMode={isExpanded ? "full" : "configOnly"}
                                configEntityIdsOverride={configEntityIds}
                                runDisabled={!hasAppConnected}
                                runDisabledContent={runDisabledContent}
                            />
                        </div>
                    </OSSdrillInUIProvider>
                </EntitySelectorProvider>
            </PlaygroundUIProvider>
        </OSSPlaygroundEntityProvider>
    )
}

const CreateEvaluatorDrawer = ({onEvaluatorCreated}: CreateEvaluatorDrawerProps) => {
    const isOpen = useAtomValue(drawerOpenAtom)
    const entityId = useAtomValue(drawerEntityIdAtom)
    const isExpanded = useAtomValue(drawerExpandedAtom)
    const closeDrawer = useSetAtom(closeDrawerAtom)

    const handleClose = useCallback(() => {
        closeDrawer()
    }, [closeDrawer])

    // Initialize playground entity IDs when drawer opens with an entity
    const setEntityIds = useSetAtom(playgroundController.actions.setEntityIds)
    useEffect(() => {
        if (isOpen && entityId) {
            setEntityIds([entityId])
        }
    }, [isOpen, entityId, setEntityIds])

    return (
        <EnhancedDrawer
            open={isOpen}
            onClose={handleClose}
            width={isExpanded ? "clamp(1155px, 92vw, 1600px)" : 800}
            destroyOnHidden
            title={null}
            closable={false}
            styles={{body: {padding: 0}}}
        >
            {isOpen && entityId && (
                <DrawerContent
                    entityId={entityId}
                    onClose={handleClose}
                    onEvaluatorCreated={onEvaluatorCreated}
                />
            )}
        </EnhancedDrawer>
    )
}

export default memo(CreateEvaluatorDrawer)
