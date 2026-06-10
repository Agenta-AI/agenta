import React, {useCallback, useMemo, useState} from "react"

import type {PlaygroundNode} from "@agenta/entities/runnable"
import {
    deriveWorkflowTypeFromRevision,
    getWorkflowTypeColor,
    parseWorkflowKeyFromUri,
    workflowMolecule,
    createEvaluatorFromTemplate,
    evaluatorWorkflowMetaMapAtom,
    workflowLatestRevisionQueryAtomFamily,
} from "@agenta/entities/workflow"
import type {EvaluatorCatalogTemplate, Workflow, WorkflowTypeColor} from "@agenta/entities/workflow"
import {EntityPicker} from "@agenta/entity-ui"
import {type WorkflowRevisionSelectionResult} from "@agenta/entity-ui/selection"
import {useEnrichedEvaluatorOnlyAdapter as useEvaluatorOnlyAdapter} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {usePlaygroundLayout} from "@agenta/playground-ui/hooks"
import {bgColors, textColors} from "@agenta/ui"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {CloseOutlined, DownOutlined, MoreOutlined} from "@ant-design/icons"
import {Gavel, PencilSimple, Plus} from "@phosphor-icons/react"
import {Button, Divider, Dropdown, Space, Tag, Tooltip, Typography, message} from "antd"
import clsx from "clsx"
import {atom, getDefaultStore, useAtomValue, useSetAtom, useStore} from "jotai"
import dynamic from "next/dynamic"

import EvaluatorTemplateDropdown from "@/oss/components/Evaluators/components/EvaluatorTemplateDropdown"
import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {routerAppIdAtom} from "@/oss/state/app/selectors/app"
import {openEvaluatorDrawerAtom} from "@/oss/state/evaluator/evaluatorDrawerStore"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"
import {currentWorkflowAtom, currentWorkflowContextAtom} from "@/oss/state/workflow"
import {workspaceMemberByIdFamily} from "@/oss/state/workspace/atoms/selectors"

import type {BaseContainerProps} from "../types"

import RunEvaluationButton from "./RunEvaluationButton"

const SelectVariant = dynamic(() => import("../Menus/SelectVariant"), {
    ssr: false,
    loading: () => (
        <Space.Compact size="small">
            <Button className="flex items-center gap-1" icon={<Plus size={14} />} disabled>
                Compare
            </Button>
            <Button icon={<DownOutlined style={{fontSize: 10}} />} disabled />
        </Space.Compact>
    ),
})

const TestsetDropdown = dynamic(() => import("../TestsetDropdown"), {ssr: false})

type PlaygroundHeaderProps = BaseContainerProps

/** Entity types that represent evaluator downstream nodes */
const EVALUATOR_ENTITY_TYPES = ["workflow"]

/** Resolves a user UUID to a display name via workspace members */
const MemberAuthor: React.FC<{userId: string}> = ({userId}) => {
    const memberAtom = useMemo(() => workspaceMemberByIdFamily(userId), [userId])
    const member = useAtomValue(memberAtom)
    const name = member?.user?.username || member?.user?.email || userId
    return <span>by {name}</span>
}

/** Compact revision label: "name vX" + "by author" */
const CompactRevisionLabel: React.FC<{entity: unknown}> = ({entity}) => {
    const r = entity as {
        version?: number
        name?: string
        created_by_id?: string
    }
    return (
        <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
                {r.name && (
                    <span className="truncate max-w-[140px]" title={r.name}>
                        {r.name}
                    </span>
                )}
                <VersionBadge version={r.version ?? 0} variant="chip" size="small" />
            </div>
            {r.created_by_id && (
                <div className={textColors.muted}>
                    <MemberAuthor userId={r.created_by_id} />
                </div>
            )}
        </div>
    )
}

/** Custom revision label renderer for entity picker */
const renderWorkflowRevisionLabel = (entity: unknown) => {
    return React.createElement(CompactRevisionLabel, {entity})
}

// ---------------------------------------------------------------------------
// EvaluatorTag — renders a single connected evaluator as a colored tag
// with its own runnable data subscription and close button.
// ---------------------------------------------------------------------------
const EvaluatorTag: React.FC<{
    node: PlaygroundNode
    onDisconnect: (nodeId: string) => void
}> = ({node, onDisconnect}) => {
    const runnableData = useAtomValue(
        useMemo(() => workflowMolecule.selectors.data(node.entityId), [node.entityId]),
    )

    const color: WorkflowTypeColor | undefined = useMemo(() => {
        if (!runnableData) return undefined
        const workflowKey = parseWorkflowKeyFromUri(runnableData.data?.uri ?? null)
        const keyColor = getWorkflowTypeColor(workflowKey)
        if (keyColor) return keyColor
        const workflowType = deriveWorkflowTypeFromRevision(runnableData, {isEvaluator: true})
        return getWorkflowTypeColor(workflowType) ?? undefined
    }, [runnableData])

    const label = useMemo(() => {
        const fetchedName = runnableData?.name?.trim()
        const name = fetchedName || runnableData?.slug?.trim() || "Evaluator"
        const version = runnableData?.version ?? null
        return version != null ? `${name} v${version}` : name
    }, [runnableData])

    return (
        <Tag
            closable
            closeIcon={<CloseOutlined style={{fontSize: 10}} />}
            onClose={(e) => {
                e.preventDefault()
                onDisconnect(node.id)
            }}
            className="flex items-center gap-1 !mr-0 max-w-[160px]"
            style={
                color
                    ? {
                          backgroundColor: color.bg,
                          color: color.text,
                          borderColor: color.border,
                      }
                    : undefined
            }
        >
            <span className="truncate">{label}</span>
        </Tag>
    )
}

// ---------------------------------------------------------------------------
// PlaygroundHeader
// ---------------------------------------------------------------------------
const PlaygroundHeader: React.FC<PlaygroundHeaderProps> = ({className, ...divProps}) => {
    // ATOM-LEVEL OPTIMIZATION: Use focused atom subscriptions instead of full playground state
    const {displayedEntities} = usePlaygroundLayout()

    // Phase 6.1.1: read from currentWorkflowAtom (resolves both apps and
    // evaluators) instead of currentAppAtom (apps-only — null for evaluators).
    // The is_custom flag still resolves correctly because it's a URI-derived
    // flag that exists on the workflow data regardless of role.
    const currentWorkflow = useAtomValue(currentWorkflowAtom)
    const currentWorkflowCtx = useAtomValue(currentWorkflowContextAtom)
    const routeAppId = useAtomValue(routerAppIdAtom)
    const isProjectLevelPlayground = !routeAppId

    // Evaluator chaining state
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const connectDownstreamNode = useSetAtom(playgroundController.actions.connectDownstreamNode)
    const disconnectDownstreamNode = useSetAtom(
        playgroundController.actions.disconnectDownstreamNode,
    )
    const disconnectSingleDownstreamNode = useSetAtom(
        playgroundController.actions.disconnectSingleDownstreamNode,
    )

    const hasRootNode = useMemo(() => nodes.some((n) => n.depth === 0), [nodes])

    // Find all connected evaluator nodes
    const connectedEvaluatorNodes = useMemo(
        () => nodes.filter((n) => n.depth > 0 && EVALUATOR_ENTITY_TYPES.includes(n.entityType)),
        [nodes],
    )

    // Set of already-connected revision IDs for disabling in the picker
    const connectedRevisionIds = useMemo(
        () => new Set(connectedEvaluatorNodes.map((n) => n.entityId)),
        [connectedEvaluatorNodes],
    )

    // Map of workflowId → connected revisions of that workflow, for the picker's
    // parent checkboxes and selected-revision chips. PlaygroundNode doesn't carry
    // metadata, so the parent workflow id and version are read reactively from
    // each connected revision's molecule data.
    const selectedChildrenByParent = useAtomValue(
        useMemo(
            () =>
                atom((get) => {
                    const entries: {workflowId: string; id: string; version: number}[] = []
                    for (const node of connectedEvaluatorNodes) {
                        const data = get(workflowMolecule.selectors.data(node.entityId)) as {
                            workflow_id?: string | null
                            version?: number | null
                        } | null
                        if (!data?.workflow_id) continue
                        entries.push({
                            workflowId: data.workflow_id,
                            id: node.entityId,
                            version: data.version ?? 0,
                        })
                    }

                    const map = new Map<string, {id: string; label: string}[]>()
                    for (const entry of entries.sort((a, b) => b.version - a.version)) {
                        const arr = map.get(entry.workflowId) ?? []
                        arr.push({id: entry.id, label: `v${entry.version}`})
                        map.set(entry.workflowId, arr)
                    }
                    return map
                }),
            [connectedEvaluatorNodes],
        ),
    )

    // Map of workflowId → total revision count, for the indeterminate checkbox state
    const workflowMetaMap = useAtomValue(evaluatorWorkflowMetaMapAtom)
    const totalChildrenByParent = useMemo(() => {
        const map = new Map<string, number>()
        for (const [workflowId, meta] of workflowMetaMap) {
            if (meta.versionCount != null) map.set(workflowId, meta.versionCount)
        }
        return map
    }, [workflowMetaMap])

    const handleDisconnectAll = useCallback(() => {
        disconnectDownstreamNode("workflow")
    }, [disconnectDownstreamNode])

    const handleDisconnectSingle = useCallback(
        (nodeId: string) => {
            disconnectSingleDownstreamNode(nodeId)
        },
        [disconnectSingleDownstreamNode],
    )

    // Disconnect a single revision by its revision (entity) id — used by the
    // picker's chips and parent checkbox uncheck.
    const handleDeselectChild = useCallback(
        (childId: string) => {
            const node = connectedEvaluatorNodes.find((n) => n.entityId === childId)
            if (node) disconnectSingleDownstreamNode(node.id)
        },
        [connectedEvaluatorNodes, disconnectSingleDownstreamNode],
    )

    // Parent checkbox toggle: check connects the workflow's latest revision,
    // uncheck disconnects every connected revision of that workflow.
    const handleParentToggle = useCallback(
        (parentId: string, checked: boolean) => {
            if (!checked) {
                selectedChildrenByParent
                    .get(parentId)
                    ?.forEach((child) => handleDeselectChild(child.id))
                return
            }

            const rootNode = nodes.find((n) => n.depth === 0)
            if (!rootNode) return

            // Latest revision is already batch-fetched and cached for the picker's metadata
            const revision = getDefaultStore().get(
                workflowLatestRevisionQueryAtomFamily(parentId),
            ).data
            if (!revision?.id || connectedRevisionIds.has(revision.id)) return

            const workflowName = revision.name?.trim() || revision.slug?.trim() || "Evaluator"
            connectDownstreamNode({
                sourceNodeId: rootNode.id,
                entity: {
                    type: "workflow",
                    id: revision.id,
                    label: `${workflowName} / v${revision.version ?? 0}`,
                    metadata: {
                        workflowId: parentId,
                        workflowName,
                        variantId: "",
                        variantName: "",
                        revision: revision.version ?? 0,
                    },
                },
            })
        },
        [
            nodes,
            selectedChildrenByParent,
            connectedRevisionIds,
            connectDownstreamNode,
            handleDeselectChild,
        ],
    )

    // Evaluator-only adapter with colored type tags, human filtering, custom revision
    // labels, and workflow metadata ("N versions · date") for the picker rows
    const evaluatorWorkflowAdapter = useEvaluatorOnlyAdapter(renderWorkflowRevisionLabel, {
        showWorkflowMeta: true,
    })

    // Controlled state for EvaluatorTemplateDropdown
    const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false)

    // Open the evaluator template dropdown (called from EntityPicker's onCreateNew)
    const handleOpenTemplateDropdown = useCallback(() => {
        setTemplateDropdownOpen(true)
    }, [])

    const openEvaluatorDrawer = useSetAtom(openEvaluatorDrawerAtom)
    const playgroundStore = useStore()
    const currentAppSelection = useMemo(() => {
        if (currentWorkflowCtx.workflowKind === "evaluator") return undefined

        const rootNode = nodes.find((node) => node.depth === 0)
        if (!rootNode) return undefined

        return {
            revisionId: rootNode.entityId,
            label: rootNode.label?.trim() || currentWorkflow?.name?.trim() || "Application",
        }
    }, [currentWorkflow?.name, currentWorkflowCtx.workflowKind, nodes])

    const handleCreatedEvaluator = useCallback(
        ({
            newAppId,
            newRevisionId,
            workflow,
        }: {
            newAppId?: string
            newRevisionId?: string
            workflow?: Workflow
        }) => {
            if (!newRevisionId) return

            if (workflow) {
                workflowMolecule.set.seedEntity(newRevisionId, workflow, {store: playgroundStore})
            }

            const currentNodes = playgroundStore.get(playgroundController.selectors.nodes())
            const rootNode = currentNodes.find((node) => node.depth === 0)
            const alreadyConnected = currentNodes.some(
                (node) => node.depth > 0 && node.entityId === newRevisionId,
            )
            if (!rootNode || alreadyConnected) return

            const workflowName = workflow?.name?.trim() || workflow?.slug?.trim() || "Evaluator"
            const revision = workflow?.version ?? 1

            playgroundStore.set(playgroundController.actions.connectDownstreamNode, {
                sourceNodeId: rootNode.id,
                entity: {
                    type: "workflow",
                    id: newRevisionId,
                    label: `${workflowName} / v${revision}`,
                    metadata: {
                        workflowId: newAppId ?? workflow?.workflow_id,
                        workflowName,
                        variantId: "",
                        variantName: "",
                        revision,
                    },
                },
            })
            workflowMolecule.cache.invalidateList()
        },
        [playgroundStore],
    )

    // Handle template selection from EvaluatorTemplateDropdown
    const handleTemplateSelect = useCallback(
        async (template: EvaluatorCatalogTemplate) => {
            const templateKey = template.key
            if (!templateKey) {
                message.error("Unable to open evaluator template")
                return
            }

            const localId = await createEvaluatorFromTemplate(templateKey)
            if (!localId) {
                message.error("Unable to create evaluator from template")
                return
            }

            openEvaluatorDrawer({
                entityId: localId,
                mode: "create",
                isolatedPlayground: true,
                initialAppSelection: currentAppSelection,
                postCreateNavigation: "stay",
                onWorkflowCreated: handleCreatedEvaluator,
            })
        },
        [currentAppSelection, handleCreatedEvaluator, openEvaluatorDrawer],
    )

    // Multi-select: toggle evaluator connection/disconnection
    const handleEvaluatorToggle = useCallback(
        (selection: WorkflowRevisionSelectionResult) => {
            const rootNode = nodes.find((n) => n.depth === 0)
            if (!rootNode) return

            // Check if this revision is already connected
            const existingNode = connectedEvaluatorNodes.find((n) => n.entityId === selection.id)

            if (existingNode) {
                // Disconnect
                disconnectSingleDownstreamNode(existingNode.id)
            } else {
                // Connect
                connectDownstreamNode({
                    sourceNodeId: rootNode.id,
                    entity: {
                        type: "workflow",
                        id: selection.id,
                        label: selection.label,
                        metadata: selection.metadata,
                    },
                })
            }
        },
        [nodes, connectedEvaluatorNodes, connectDownstreamNode, disconnectSingleDownstreamNode],
    )

    // Simplified refresh function - atoms will handle the data updates automatically
    const handleUpdate = useCallback(async () => {
        // For now, use a simple page reload since atoms auto-refresh on mount
        // This is much simpler than complex state mutations
        window.location.reload()
    }, [])

    const {openModal} = useCustomWorkflowConfig({
        afterConfigSave: handleUpdate,
    })

    const onAddVariant = useCallback((value: any) => {
        // Handle different data structures that TreeSelect might pass
        let variantIds: string[] = []

        if (Array.isArray(value)) {
            // Multiple selection mode - array of values
            variantIds = value
                .map((item: any) => (typeof item === "string" ? item : item?.value || item))
                .filter(Boolean) // Remove any undefined/null values
        } else if (value !== undefined && value !== null) {
            // Single selection mode - single value
            const singleId = typeof value === "string" ? value : value?.value || value
            if (singleId) {
                variantIds = [singleId]
            }
        }

        if (variantIds.length > 0) {
            void writePlaygroundSelectionToQuery(variantIds)
            return
        }

        void writePlaygroundSelectionToQuery([])
        console.warn("[PlaygroundHeader] No valid variant IDs found in selection:", value)
    }, [])

    return (
        <>
            <div
                className={clsx(
                    "flex items-center justify-between gap-4 px-2.5 py-2",
                    bgColors.active,
                    className,
                )}
                {...divProps}
            >
                <div className="flex shrink-0 items-center gap-2">
                    {currentWorkflow?.flags?.is_custom ? (
                        <Dropdown
                            trigger={["click"]}
                            styles={{
                                root: {
                                    width: 180,
                                },
                            }}
                            menu={{
                                items: [
                                    ...[
                                        {
                                            key: "configure",
                                            label: "Configure workflow",
                                            icon: <PencilSimple size={16} />,
                                            onClick: openModal,
                                        },
                                    ],
                                ],
                            }}
                        >
                            <Button type="text" icon={<MoreOutlined />} />
                        </Dropdown>
                    ) : null}
                    <Typography className="whitespace-nowrap text-[16px] leading-[18px] font-[600]">
                        Playground
                    </Typography>
                </div>

                <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
                    {connectedEvaluatorNodes.length > 0 && (
                        <div className="min-w-0 flex-1 overflow-x-auto">
                            <div className="flex w-max items-center gap-1 pr-1">
                                {connectedEvaluatorNodes.map((node) => (
                                    <EvaluatorTag
                                        key={node.id}
                                        node={node}
                                        onDisconnect={handleDisconnectSingle}
                                    />
                                ))}
                            </div>
                        </div>
                    )}
                    {/* Phase 6.1.2: hide "New Evaluation" for evaluator
                     * workflows — running an evaluation FROM an evaluator's
                     * playground doesn't make sense (would evaluate itself). */}
                    {currentWorkflowCtx.workflowKind !== "evaluator" && <RunEvaluationButton />}
                    <Divider orientation="vertical" className="!mx-0 h-5" />
                    <span className="relative inline-flex">
                        <Tooltip title="Add evaluators to automatically score outputs in the playground.">
                            <span>
                                <EntityPicker<WorkflowRevisionSelectionResult>
                                    variant="popover-cascader"
                                    adapter={evaluatorWorkflowAdapter}
                                    onSelect={handleEvaluatorToggle}
                                    size="small"
                                    placeholder="Evaluator"
                                    icon={<Gavel size={14} />}
                                    disabled={!hasRootNode}
                                    multiSelect
                                    selectedChildIds={connectedRevisionIds}
                                    selectionSummary
                                    childItemLabelMode="simple"
                                    panelWidth={280}
                                    showParentCheckboxes
                                    selectedChildrenByParent={selectedChildrenByParent}
                                    totalChildrenByParent={totalChildrenByParent}
                                    onParentToggle={handleParentToggle}
                                    onDeselectChild={handleDeselectChild}
                                    showParentDescription
                                    showGroupHeaders
                                    showChildSelectAll
                                    onClearAll={handleDisconnectAll}
                                    onCreateNew={handleOpenTemplateDropdown}
                                    createNewLabel="Create new"
                                    popupFooter={
                                        connectedEvaluatorNodes.length > 0 ? (
                                            <div className="border-0 border-t border-solid border-[var(--ag-rgba-051729-06)] p-2">
                                                <Button
                                                    size="small"
                                                    danger
                                                    className="w-full"
                                                    onClick={handleDisconnectAll}
                                                >
                                                    Disconnect all
                                                </Button>
                                            </div>
                                        ) : undefined
                                    }
                                />
                            </span>
                        </Tooltip>
                        <EvaluatorTemplateDropdown
                            onSelect={handleTemplateSelect}
                            open={templateDropdownOpen}
                            onOpenChange={setTemplateDropdownOpen}
                            placement="bottomLeft"
                            className="pointer-events-none absolute inset-0"
                            trigger={<span className="block size-full" />}
                        />
                    </span>
                    <TestsetDropdown />
                    {isProjectLevelPlayground ? (
                        <Tooltip title="Compare mode is unavailable in project-level playground">
                            <Space.Compact size="small">
                                <Button
                                    className="flex items-center gap-1"
                                    icon={<Plus size={14} />}
                                    disabled
                                >
                                    Compare
                                </Button>
                                <Button icon={<DownOutlined style={{fontSize: 10}} />} disabled />
                            </Space.Compact>
                        </Tooltip>
                    ) : (
                        <SelectVariant
                            showAsCompare
                            multiple
                            onChange={(value) => onAddVariant(value)}
                            value={displayedEntities}
                        />
                    )}
                </div>
            </div>
        </>
    )
}

export default PlaygroundHeader
