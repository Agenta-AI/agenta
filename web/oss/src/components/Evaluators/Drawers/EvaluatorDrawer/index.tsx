/**
 * EvaluatorDrawer
 *
 * A globally-mounted drawer for evaluator configuration.
 * Embeds the playground infrastructure matching the evaluator playground page behavior:
 *
 * Phase 1: Evaluator is primary node → config panel only, run disabled with app picker
 * Phase 2: App selected → app becomes primary, evaluator moves downstream, run enabled
 *
 * Modes:
 * - "create": New ephemeral entity from template (via NewEvaluation modal)
 * - "view": Existing committed entity (via evaluators table row click)
 */
import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"

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
import {type PlaygroundUIProviders} from "@agenta/playground-ui"
import {ArrowsIn, ArrowsOut, PencilSimple} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import {atom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import SimpleSharedEditor from "@/oss/components/EditorViews/SimpleSharedEditor"
import EnhancedDrawer from "@/oss/components/EnhancedUIs/Drawer"
import {
    connectAppToEvaluatorAtom,
    evaluatorConfigEntityIdsAtom,
    hasAppConnectedAtom,
    selectedAppLabelAtom,
} from "@/oss/components/Evaluators/components/ConfigureEvaluator/atoms"
import {clearEvaluatorWorkflowCache} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import PlaygroundTestcaseEditor from "@/oss/components/Playground/Components/PlaygroundTestcaseEditor"
import {OSSPlaygroundShell} from "@/oss/components/Playground/OSSPlaygroundShell"
import SharedGenerationResultUtils from "@/oss/components/SharedGenerationResultUtils"

import {
    closeEvaluatorDrawerAtom,
    evaluatorDrawerCallbackAtom,
    evaluatorDrawerEntityIdAtom,
    evaluatorDrawerExpandedAtom,
    evaluatorDrawerOpenAtom,
} from "./store/evaluatorDrawerStore"

const PlaygroundMainView = dynamic(
    () => import("@/oss/components/Playground/Components/MainLayout"),
    {ssr: false},
)

const TestsetDropdown = dynamic(
    () => import("@/oss/components/Playground/Components/TestsetDropdown"),
    {ssr: false},
)

const DrawerHeader = ({onClose}: {onClose: () => void}) => {
    const isExpanded = useAtomValue(evaluatorDrawerExpandedAtom)
    const setExpanded = useSetAtom(evaluatorDrawerExpandedAtom)

    const hasAppConnected = useAtomValue(hasAppConnectedAtom)
    const selectedAppLabel = useAtomValue(selectedAppLabelAtom)
    const connectApp = useSetAtom(connectAppToEvaluatorAtom)

    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const evaluatorNode = useMemo(() => {
        const downstream = nodes.find((n) => n.depth > 0)
        if (downstream) return downstream
        return nodes[0] ?? null
    }, [nodes])

    // Read + edit evaluator name
    const evaluatorEntityId = evaluatorNode?.entityId ?? null
    const entityData = useAtomValue(
        useMemo(
            () =>
                evaluatorEntityId ? workflowMolecule.selectors.data(evaluatorEntityId) : atom(null),
            [evaluatorEntityId],
        ),
    )
    const name = entityData?.name?.trim() || entityData?.slug?.trim() || "New Evaluator"
    const dispatchUpdate = useSetAtom(workflowMolecule.actions.update)
    const handleNameChange = useCallback(
        (newName: string) => {
            if (!evaluatorEntityId || !newName.trim()) return
            dispatchUpdate(evaluatorEntityId, {name: newName.trim()})
        },
        [evaluatorEntityId, dispatchUpdate],
    )

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

    const [isEditingName, setIsEditingName] = useState(false)
    const [editName, setEditName] = useState(name)

    // Sync editName when entity name changes externally
    useEffect(() => {
        if (!isEditingName) setEditName(name)
    }, [name, isEditingName])

    const handleNameBlur = useCallback(() => {
        setIsEditingName(false)
        if (editName.trim() && editName.trim() !== name) {
            handleNameChange(editName.trim())
        } else {
            setEditName(name)
        }
    }, [editName, name, handleNameChange])

    const handleNameKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                ;(e.target as HTMLInputElement).blur()
            } else if (e.key === "Escape") {
                setEditName(name)
                setIsEditingName(false)
            }
        },
        [name],
    )

    return (
        <div className="flex items-center justify-between px-4 py-2.5 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
            {isEditingName ? (
                <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onBlur={handleNameBlur}
                    onKeyDown={handleNameKeyDown}
                    autoFocus
                    className="text-[16px] leading-[24px] font-semibold tracking-normal bg-transparent border-0 outline-none p-0 m-0 min-w-[120px] max-w-[50%] font-[inherit]"
                />
            ) : (
                <div
                    className="flex items-center gap-1.5 cursor-text"
                    onClick={() => setIsEditingName(true)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setIsEditingName(true)
                    }}
                >
                    <span className="text-[16px] leading-[24px] font-semibold tracking-normal">
                        {name}
                    </span>
                    <PencilSimple
                        size={14}
                        className="text-gray-400 flex-shrink-0"
                        aria-hidden="true"
                    />
                </div>
            )}
            <div className="flex items-center gap-1">
                {isExpanded && (
                    <>
                        <EntityPicker<WorkflowRevisionSelectionResult>
                            variant="popover-cascader"
                            adapter={appWorkflowAdapter}
                            onSelect={handleAppSelect}
                            size="small"
                            placeholder={selectedAppLabel ?? "Select app"}
                        />
                        {hasAppConnected && <TestsetDropdown />}
                    </>
                )}
                <Button
                    onClick={() => setExpanded(!isExpanded)}
                    type="text"
                    size="small"
                    icon={isExpanded ? <ArrowsIn size={16} /> : <ArrowsOut size={16} />}
                >
                    {isExpanded ? "Close Playground" : "Open in Playground"}
                </Button>
                <Button type="text" size="small" onClick={onClose}>
                    Close
                </Button>
            </div>
        </div>
    )
}

const DrawerContent = ({entityId, onClose}: {entityId: string; onClose: () => void}) => {
    const isExpanded = useAtomValue(evaluatorDrawerExpandedAtom)
    const hasAppConnected = useAtomValue(hasAppConnectedAtom)
    const configEntityIds = useAtomValue(evaluatorConfigEntityIdsAtom)
    const connectApp = useSetAtom(connectAppToEvaluatorAtom)
    const selectedAppLabel = useAtomValue(selectedAppLabelAtom)
    const drawerCallback = useAtomValue(evaluatorDrawerCallbackAtom)

    const drawerCallbackRef = useRef(drawerCallback)
    drawerCallbackRef.current = drawerCallback

    const onCloseRef = useRef(onClose)
    onCloseRef.current = onClose

    // Register commit callback to intercept the new revision ID.
    // Chain with any existing onNewRevision (e.g., from workflowEntityBridge)
    // and restore the previous handler on cleanup.
    useEffect(() => {
        const previousOnNewRevision = getWorkflowCommitCallbacks().onNewRevision

        registerWorkflowCommitCallbacks({
            onNewRevision: async (result, params) => {
                clearEvaluatorWorkflowCache()
                // Call the previous handler first (entity switch, etc.)
                await previousOnNewRevision?.(result, params)
                onCloseRef.current()
                drawerCallbackRef.current?.(result.newRevisionId)
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
        <OSSPlaygroundShell providers={providers}>
            <div className="flex flex-col w-full h-full overflow-hidden">
                <DrawerHeader onClose={onClose} />
                <PlaygroundMainView
                    mode="evaluator"
                    viewMode={isExpanded ? "full" : "configOnly"}
                    configEntityIdsOverride={configEntityIds}
                    runDisabled={!hasAppConnected}
                    runDisabledContent={runDisabledContent}
                />
            </div>
        </OSSPlaygroundShell>
    )
}

const EvaluatorDrawer = () => {
    const isOpen = useAtomValue(evaluatorDrawerOpenAtom)
    const entityId = useAtomValue(evaluatorDrawerEntityIdAtom)
    const isExpanded = useAtomValue(evaluatorDrawerExpandedAtom)
    const closeDrawer = useSetAtom(closeEvaluatorDrawerAtom)

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
            {isOpen && entityId && <DrawerContent entityId={entityId} onClose={handleClose} />}
        </EnhancedDrawer>
    )
}

export default memo(EvaluatorDrawer)
