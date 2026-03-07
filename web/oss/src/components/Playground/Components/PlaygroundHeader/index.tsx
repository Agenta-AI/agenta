import React, {useCallback, useMemo} from "react"

import {getEvaluatorColor} from "@agenta/entities/evaluator"
import type {EvaluatorColor} from "@agenta/entities/evaluator"
import {runnableBridge} from "@agenta/entities/runnable"
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {EntityPicker} from "@agenta/entity-ui"
import {type WorkflowRevisionSelectionResult} from "@agenta/entity-ui/selection"
import {playgroundController} from "@agenta/playground"
import {usePlaygroundLayout} from "@agenta/playground-ui/hooks"
import {textColors} from "@agenta/ui"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {CloseOutlined, DownOutlined, MoreOutlined} from "@ant-design/icons"
import {LinkSimple, PencilSimple, Plus} from "@phosphor-icons/react"
import {Button, Dropdown, Space, Tag, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {currentAppAtom} from "@/oss/state/app"
import {routerAppIdAtom} from "@/oss/state/app/selectors/app"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"
import {workspaceMemberByIdFamily} from "@/oss/state/workspace/atoms/selectors"

import {useEvaluatorOnlyAdapter} from "../../hooks/useEvaluatorBrowseAdapter"
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
        useMemo(() => runnableBridge.data(node.entityId), [node.entityId]),
    ) as {
        name?: string | null
        slug?: string | null
        uri?: string | null
        version?: number | null
    } | null

    const color: EvaluatorColor | undefined = useMemo(() => {
        if (!runnableData?.uri) return undefined
        return getEvaluatorColor(runnableData.uri) ?? undefined
    }, [runnableData])

    const label = useMemo(() => {
        const fetchedName = runnableData?.name?.trim()
        const name = fetchedName || runnableData?.slug?.trim() || "Evaluator"
        const version = runnableData?.version
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
    const classes = useStyles()

    // ATOM-LEVEL OPTIMIZATION: Use focused atom subscriptions instead of full playground state
    const {displayedEntities} = usePlaygroundLayout()

    const currentApp = useAtomValue(currentAppAtom)
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
    }, [disconnectDownstreamNode])

    const handleDisconnectSingle = useCallback(
        (nodeId: string) => {
            disconnectSingleDownstreamNode(nodeId)
        },
        [disconnectSingleDownstreamNode],
    )

    // Evaluator-only adapter with colored type tags, human filtering, and custom revision labels
    const evaluatorWorkflowAdapter = useEvaluatorOnlyAdapter(renderWorkflowRevisionLabel)

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
                <div className="flex shrink-0 items-center gap-2">
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
                    <EntityPicker<WorkflowRevisionSelectionResult>
                        variant="popover-cascader"
                        adapter={evaluatorWorkflowAdapter}
                        onSelect={handleEvaluatorSelect}
                        size="small"
                        placeholder="Evaluator"
                        icon={<LinkSimple size={14} />}
                        disabled={!hasRootNode}
                        disabledChildIds={connectedRevisionIds}
                        popupFooter={
                            connectedEvaluatorNodes.length > 0 ? (
                                <div className="border-t border-solid border-[rgba(5,23,41,0.06)] p-2">
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
                    <RunEvaluationButton />
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
