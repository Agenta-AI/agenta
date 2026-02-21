import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    getEvaluatorColor,
    parseEvaluatorKeyFromUri,
    evaluatorsListDataAtom,
} from "@agenta/entities/evaluator"
import type {EvaluatorColor} from "@agenta/entities/evaluator"
import {runnableBridge} from "@agenta/entities/runnable"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {EntityPicker} from "@agenta/entity-ui"
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {usePlaygroundLayout} from "@agenta/playground-ui/hooks"
import {axios, getAgentaApiUrl} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {EntityListItemLabel, RevisionLabel} from "@agenta/ui/components/presentational"
import {CloseOutlined, DownOutlined, MoreOutlined} from "@ant-design/icons"
import {LinkSimple, PencilSimple, Plus} from "@phosphor-icons/react"
import {Button, Dropdown, Popover, Space, Tag, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {currentAppAtom} from "@/oss/state/app"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"
import {workspaceMemberByIdFamily} from "@/oss/state/workspace/atoms/selectors"

import type {BaseContainerProps} from "../types"

import RunEvaluationButton from "./RunEvaluationButton"
import {useStyles} from "./styles"

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

/** Custom revision label that resolves author UUIDs to names */
const renderWorkflowRevisionLabel = (entity: unknown) => {
    const r = entity as {
        version?: number
        name?: string
        created_at?: string
        created_by_id?: string
    }
    return React.createElement(RevisionLabel, {
        version: r.version ?? 0,
        message: r.name,
        createdAt: r.created_at,
        author: r.created_by_id,
        renderAuthor: (id: string) => React.createElement(MemberAuthor, {userId: id}),
        maxMessageWidth: 180,
    })
}

// ---------------------------------------------------------------------------
// Evaluator key lookup map: workflowId → evaluatorKey
// Batch-fetches revision data for all evaluator workflows to resolve URIs.
// ---------------------------------------------------------------------------

/**
 * Hook that batch-fetches evaluator revisions and returns a
 * workflowId → evaluatorKey lookup map.
 *
 * Fetches once per set of workflow IDs and caches the result.
 */
function useEvaluatorKeyMap(workflowIds: string[]): Map<string, string> {
    const projectId = useAtomValue(projectIdAtom)
    const [keyMap, setKeyMap] = useState<Map<string, string>>(new Map())
    const fetchedRef = useRef<string>("")

    // Stable key for the current set of workflow IDs
    const idsKey = useMemo(() => [...workflowIds].sort().join(","), [workflowIds])

    useEffect(() => {
        if (!projectId || workflowIds.length === 0 || idsKey === fetchedRef.current) return
        fetchedRef.current = idsKey

        const fetchKeys = async () => {
            try {
                const response = await axios.post(
                    `${getAgentaApiUrl()}/preview/workflows/revisions/query`,
                    {
                        workflow_refs: workflowIds.map((id) => ({id})),
                    },
                    {params: {project_id: projectId}},
                )

                const revisions = response.data?.workflow_revisions ?? []
                const map = new Map<string, string>()

                for (const rev of revisions) {
                    const workflowId = rev.workflow_id
                    const uri = rev.data?.uri
                    if (workflowId && uri) {
                        const key = parseEvaluatorKeyFromUri(uri)
                        if (key) {
                            map.set(workflowId, key)
                        }
                    }
                }

                setKeyMap(map)
            } catch (err) {
                console.warn("[useEvaluatorKeyMap] Failed to fetch evaluator revisions:", err)
            }
        }

        void fetchKeys()
    }, [projectId, workflowIds, idsKey])

    return keyMap
}

/**
 * Build a getLabelNode callback for the evaluator picker grandparent level.
 * Uses pre-fetched evaluator key map and evaluator definitions for display names.
 */
function buildEvaluatorPickerLabelNode(
    evaluatorKeyMap: Map<string, string>,
    evaluatorDefsByKey: Map<string, string>,
) {
    return (entity: unknown): React.ReactNode => {
        const w = entity as {
            id: string
            name?: string
            flags?: {is_human?: boolean; is_custom?: boolean} | null
        }
        const name = w.name ?? "Unnamed"

        // Resolve tag label and color key:
        // 1. For human evaluators, use "Human" label directly from flags
        // 2. For custom evaluators, use "Custom Code" label directly from flags
        // 3. For built-in evaluators, look up from revision data URI → evaluator defs
        let tagLabel: string | null = null
        let colorSource: string | null = null

        if (w.flags?.is_human) {
            tagLabel = "Human"
            colorSource = "human"
        } else if (w.flags?.is_custom) {
            tagLabel = "Custom Code"
            colorSource = "custom"
        } else {
            const evaluatorKey = evaluatorKeyMap.get(w.id)
            if (evaluatorKey) {
                tagLabel = evaluatorDefsByKey.get(evaluatorKey) ?? null
                colorSource = evaluatorKey
            }
        }

        const color = colorSource ? getEvaluatorColor(colorSource) : null

        const tag = tagLabel
            ? React.createElement(
                  "span",
                  {
                      className: "text-[10px] px-1.5 py-0.5 rounded",
                      style: color
                          ? {
                                backgroundColor: color.bg,
                                color: color.text,
                                borderColor: color.border,
                                borderWidth: "1px",
                                borderStyle: "solid",
                            }
                          : undefined,
                  },
                  tagLabel,
              )
            : undefined

        return React.createElement(EntityListItemLabel, {
            label: name,
            trailing: tag,
        })
    }
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
        useMemo(() => runnableBridge.data(node.entityId), [node.entityId]),
    ) as {name?: string | null; slug?: string | null; uri?: string | null} | null

    const color: EvaluatorColor | undefined = useMemo(() => {
        if (!runnableData?.uri) return undefined
        return getEvaluatorColor(runnableData.uri) ?? undefined
    }, [runnableData])

    const label = useMemo(() => {
        const nodeLabel = node.label?.trim()
        if (nodeLabel && nodeLabel !== node.entityId) return nodeLabel
        const fetchedName = runnableData?.name?.trim()
        if (fetchedName) return fetchedName
        const fetchedSlug = runnableData?.slug?.trim()
        if (fetchedSlug) return fetchedSlug
        return "Evaluator"
    }, [node, runnableData])

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
    const classes = useStyles()

    // ATOM-LEVEL OPTIMIZATION: Use focused atom subscriptions instead of full playground state
    const {displayedEntities} = usePlaygroundLayout()

    const currentApp = useAtomValue(currentAppAtom)

    // Evaluator chaining state
    const nodes = useAtomValue(useMemo(() => playgroundController.selectors.nodes(), []))
    const connectDownstreamNode = useSetAtom(playgroundController.actions.connectDownstreamNode)
    const disconnectDownstreamNode = useSetAtom(
        playgroundController.actions.disconnectDownstreamNode,
    )
    const disconnectSingleDownstreamNode = useSetAtom(
        playgroundController.actions.disconnectSingleDownstreamNode,
    )
    const [evaluatorPopoverOpen, setEvaluatorPopoverOpen] = useState(false)

    const hasRootNode = useMemo(() => nodes.some((n) => n.depth === 0), [nodes])

    // Find all connected evaluator nodes
    const connectedEvaluatorNodes = useMemo(
        () => nodes.filter((n) => n.depth > 0 && EVALUATOR_ENTITY_TYPES.includes(n.entityType)),
        [nodes],
    )

    const handleEvaluatorSelect = useCallback(
        (selection: WorkflowRevisionSelectionResult) => {
            const rootNode = nodes.find((n) => n.depth === 0)
            if (!rootNode) return

            connectDownstreamNode({
                sourceNodeId: rootNode.id,
                entity: {
                    type: "workflow",
                    id: selection.id,
                    label: selection.label,
                    metadata: selection.metadata,
                },
            })
        },
        [nodes, connectDownstreamNode],
    )

    const handleDisconnectAll = useCallback(() => {
        disconnectDownstreamNode("workflow")
        setEvaluatorPopoverOpen(false)
    }, [disconnectDownstreamNode])

    const handleDisconnectSingle = useCallback(
        (nodeId: string) => {
            disconnectSingleDownstreamNode(nodeId)
        },
        [disconnectSingleDownstreamNode],
    )

    // Read evaluator definitions for picker label rendering
    const evaluatorDefs = useAtomValue(evaluatorsAtom)

    // Build a stable lookup map: evaluator key → display name
    const evaluatorDefsByKey = useMemo(
        () => new Map(evaluatorDefs.map((d) => [d.key, d.name])),
        [evaluatorDefs],
    )

    // Get evaluator workflow IDs from the evaluator entity list
    const evaluatorWorkflows = useAtomValue(evaluatorsListDataAtom)
    const evaluatorWorkflowIds = useMemo(
        () => evaluatorWorkflows.map((w) => w.id),
        [evaluatorWorkflows],
    )

    // Batch-fetch evaluator keys from revision data
    const evaluatorKeyMap = useEvaluatorKeyMap(evaluatorWorkflowIds)

    // Workflow adapter filtered to evaluator-type workflows (3-level: Workflow → Variant → Revision)
    const evaluatorWorkflowAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                flags: {is_evaluator: true, is_human: false},
                grandparentOverrides: {
                    getLabelNode: buildEvaluatorPickerLabelNode(
                        evaluatorKeyMap,
                        evaluatorDefsByKey,
                    ),
                },
                revisionOverrides: {getLabelNode: renderWorkflowRevisionLabel},
            }),
        [evaluatorKeyMap, evaluatorDefsByKey],
    )

    // Simplified refresh function - atoms will handle the data updates automatically
    const handleUpdate = useCallback(async () => {
        // For now, use a simple page reload since atoms auto-refresh on mount
        // This is much simpler than complex state mutations
        window.location.reload()
    }, [])

    const {openModal} = useCustomWorkflowConfig({
        afterConfigSave: handleUpdate,
        configureWorkflow: true,
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
                    classes.header,
                    className,
                )}
                {...divProps}
            >
                <div className="flex items-center gap-2">
                    {currentApp?.app_type === "custom" ? (
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
                    <Typography className="text-[16px] leading-[18px] font-[600]">
                        Playground
                    </Typography>
                </div>

                <div className="flex items-center gap-2">
                    {connectedEvaluatorNodes.length > 0 && (
                        <div className="flex items-center gap-1">
                            {connectedEvaluatorNodes.map((node) => (
                                <EvaluatorTag
                                    key={node.id}
                                    node={node}
                                    onDisconnect={handleDisconnectSingle}
                                />
                            ))}
                        </div>
                    )}
                    <Popover
                        open={evaluatorPopoverOpen}
                        onOpenChange={setEvaluatorPopoverOpen}
                        trigger="click"
                        placement="bottomRight"
                        arrow={false}
                        destroyOnHidden
                        styles={{body: {padding: 0}}}
                        content={
                            <div style={{width: 320}}>
                                <EntityPicker<WorkflowRevisionSelectionResult>
                                    variant="breadcrumb"
                                    adapter={evaluatorWorkflowAdapter}
                                    onSelect={handleEvaluatorSelect}
                                    showSearch
                                    showBreadcrumb
                                    showBackButton
                                    rootLabel="Evaluators"
                                    emptyMessage="No evaluators available"
                                    loadingMessage="Loading evaluators..."
                                    maxHeight={250}
                                    instanceId="playground-header-evaluator"
                                    breadcrumbActions={
                                        connectedEvaluatorNodes.length > 0 ? (
                                            <Button
                                                size="small"
                                                danger
                                                className="!h-6 !px-2 !text-xs whitespace-nowrap"
                                                onClick={handleDisconnectAll}
                                            >
                                                Disconnect all
                                            </Button>
                                        ) : undefined
                                    }
                                />
                            </div>
                        }
                    >
                        <Button
                            size="small"
                            className="flex items-center gap-1"
                            icon={<LinkSimple size={14} />}
                            disabled={!hasRootNode}
                        >
                            Evaluator
                            <DownOutlined style={{fontSize: 10}} />
                        </Button>
                    </Popover>
                    <RunEvaluationButton />
                    <SelectVariant
                        showAsCompare
                        multiple
                        onChange={(value) => onAddVariant(value)}
                        value={displayedEntities}
                    />
                </div>
            </div>
        </>
    )
}

export default PlaygroundHeader
