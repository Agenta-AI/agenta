import React, {useCallback, useMemo, useState} from "react"

import {getEvaluatorColor} from "@agenta/entities/evaluator"
import {runnableBridge} from "@agenta/entities/runnable"
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {EntityPicker} from "@agenta/entity-ui"
import {playgroundController} from "@agenta/playground"
import {usePlaygroundLayout} from "@agenta/playground-ui/hooks"
import {RevisionLabel} from "@agenta/ui/components/presentational"
import {DisconnectOutlined, DownOutlined, MoreOutlined} from "@ant-design/icons"
import {LinkSimple, PencilSimple, Plus} from "@phosphor-icons/react"
import {Button, Dropdown, Popover, Space, Typography} from "antd"
import clsx from "clsx"
import {atom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
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
    const [evaluatorPopoverOpen, setEvaluatorPopoverOpen] = useState(false)

    const hasRootNode = useMemo(() => nodes.some((n) => n.depth === 0), [nodes])

    // Find connected evaluator node (any downstream node with evaluator type)
    const connectedEvaluatorNode = useMemo(
        () =>
            nodes.find(
                (n) => n.depth > 0 && EVALUATOR_ENTITY_TYPES.includes(n.entityType),
            ),
        [nodes],
    )

    // Read runnable data via the bridge (routes to the correct molecule by entity type).
    const connectedEvaluatorRunnableData = useAtomValue(
        useMemo(
            () =>
                connectedEvaluatorNode?.entityId
                    ? runnableBridge.data(connectedEvaluatorNode.entityId)
                    : atom(null),
            [connectedEvaluatorNode?.entityId],
        ),
    ) as {
        name?: string | null
        slug?: string | null
        uri?: string | null
    } | null

    const connectedEvaluatorColor = useMemo(() => {
        if (!connectedEvaluatorRunnableData?.uri) return undefined
        return getEvaluatorColor(connectedEvaluatorRunnableData.uri) ?? undefined
    }, [connectedEvaluatorRunnableData])

    const connectedEvaluatorLabel = useMemo(() => {
        if (!connectedEvaluatorNode) return "Evaluator"

        // Prefer snapshot/selection-provided label (includes evaluator + variant + revision context).
        const nodeLabel = connectedEvaluatorNode.label?.trim()
        if (nodeLabel && nodeLabel !== connectedEvaluatorNode.entityId) return nodeLabel

        const fetchedName = connectedEvaluatorRunnableData?.name?.trim()
        if (fetchedName) return fetchedName

        const fetchedSlug = connectedEvaluatorRunnableData?.slug?.trim()
        if (fetchedSlug) return fetchedSlug

        return "Evaluator"
    }, [connectedEvaluatorNode, connectedEvaluatorRunnableData])

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

            setEvaluatorPopoverOpen(false)
        },
        [nodes, connectDownstreamNode],
    )

    const handleDisconnectEvaluator = useCallback(() => {
        if (connectedEvaluatorNode?.entityType) {
            disconnectDownstreamNode(connectedEvaluatorNode.entityType)
        } else {
            disconnectDownstreamNode("workflow")
        }
        setEvaluatorPopoverOpen(false)
    }, [connectedEvaluatorNode?.entityType, disconnectDownstreamNode])

    // Workflow adapter filtered to evaluator-type workflows (3-level: Workflow → Variant → Revision)
    const evaluatorWorkflowAdapter = useMemo(
        () =>
            createWorkflowRevisionAdapter({
                flags: {is_evaluator: true},
                revisionOverrides: {getLabelNode: renderWorkflowRevisionLabel},
            }),
        [],
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
        console.warn("🚨 [PlaygroundHeader] No valid variant IDs found in selection:", value)
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
                    <Space.Compact size="small">
                        <Button
                            className="flex items-center gap-1"
                            icon={<LinkSimple size={14} />}
                            disabled={!hasRootNode}
                            style={
                                connectedEvaluatorColor
                                    ? {
                                          backgroundColor: connectedEvaluatorColor.bg,
                                          color: connectedEvaluatorColor.text,
                                          borderColor: connectedEvaluatorColor.border,
                                      }
                                    : undefined
                            }
                        >
                            {connectedEvaluatorLabel}
                        </Button>
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
                                            connectedEvaluatorNode ? (
                                                <Button
                                                    size="small"
                                                    danger
                                                    icon={<DisconnectOutlined />}
                                                    className="!h-6 !px-2 !text-xs whitespace-nowrap"
                                                    onClick={handleDisconnectEvaluator}
                                                >
                                                    Disconnect
                                                </Button>
                                            ) : undefined
                                        }
                                    />
                                </div>
                            }
                        >
                            <Button
                                icon={<DownOutlined style={{fontSize: 10}} />}
                                disabled={!hasRootNode}
                                style={
                                    connectedEvaluatorColor
                                        ? {
                                              backgroundColor: connectedEvaluatorColor.bg,
                                              color: connectedEvaluatorColor.text,
                                              borderColor: connectedEvaluatorColor.border,
                                          }
                                        : undefined
                                }
                            />
                        </Popover>
                    </Space.Compact>
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
