import React, {useCallback, useEffect, useMemo, useState} from "react"

import type {PlaygroundNode} from "@agenta/entities/runnable"
import {isLocalDraftId} from "@agenta/entities/shared"
import {
    activateEvaluatorEnrichmentAtom,
    deriveWorkflowTypeFromRevision,
    getWorkflowTypeColor,
    parseWorkflowKeyFromUri,
    workflowMolecule,
    createEvaluatorFromTemplate,
    evaluatorNameByRevisionAtomFamily,
    evaluatorWorkflowMetaMapAtom,
} from "@agenta/entities/workflow"
import type {EvaluatorCatalogTemplate, Workflow, WorkflowTypeColor} from "@agenta/entities/workflow"
import {EntityPicker} from "@agenta/entity-ui"
import {type WorkflowRevisionSelectionResult} from "@agenta/entity-ui/selection"
import {useEnrichedEvaluatorOnlyAdapter as useEvaluatorOnlyAdapter} from "@agenta/entity-ui/selection"
import {playgroundController, isAgentModeAtomFamily} from "@agenta/playground"
import {AgentPageHeader} from "@agenta/playground-ui/agent-page-header"
import {usePlaygroundLayout} from "@agenta/playground-ui/hooks"
import {PlaygroundModeSwitch} from "@agenta/playground-ui/mode-switch"
import {textColors} from "@agenta/ui"
import {message} from "@agenta/ui/app-message"
import {VersionBadge} from "@agenta/ui/components/presentational"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {
    CaretDown,
    Check,
    DotsThree,
    Gavel,
    GearSix,
    PencilSimple,
    Plus,
    X,
} from "@phosphor-icons/react"
import {atom, useAtomValue, useSetAtom, useStore} from "jotai"
import dynamic from "next/dynamic"

import {
    AGENT_CHAT_ITEM_ESTIMATE_OPTIONS,
    AGENT_CHAT_OVERSCAN_OPTIONS,
    agentChatItemEstimateAtom,
    agentChatOverscanAtom,
    agentChatVirtualizeAtom,
    isAgentChatVirtualizationAvailable,
} from "@/oss/components/AgentChatSlice/state/virtualization"
import {AgentIconTrigger} from "@/oss/components/AgentIconChip"
import {AgentNameInline} from "@/oss/components/EntityIdentity"
import EvaluatorTemplateDropdown from "@/oss/components/Evaluators/components/EvaluatorTemplateDropdown"
import {useOptionalOnboardingContext} from "@/oss/components/pages/agent-home/PlaygroundOnboarding/OnboardingContext"
import useCustomWorkflowConfig from "@/oss/components/pages/app-management/modals/CustomWorkflowModal/hooks/useCustomWorkflowConfig"
import {routerAppIdAtom} from "@/oss/state/app/selectors/app"
import {openEvaluatorDrawerAtom} from "@/oss/state/evaluator/evaluatorDrawerStore"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"
import {
    currentWorkflowAtom,
    currentWorkflowContextAtom,
    playgroundEarlyAgentStateAtom,
} from "@/oss/state/workflow"
import {workspaceMemberByIdFamily} from "@/oss/state/workspace/atoms/selectors"

import AgentRevisionSelector from "../AgentRevisionSelector"
import type {BaseContainerProps} from "../types"

import RunEvaluationButton from "./RunEvaluationButton"

const SelectVariant = dynamic(() => import("../Menus/SelectVariant"), {
    ssr: false,
    loading: () => (
        <span className="inline-flex">
            <Button variant="outline" size="sm" disabled className="rounded-r-none">
                <Plus size={14} />
                Compare
            </Button>
            <Button
                variant="outline"
                size="icon-sm"
                disabled
                aria-label="Compare options"
                className="-ml-px rounded-l-none"
            >
                <CaretDown size={10} />
            </Button>
        </span>
    ),
})

const TestsetDropdown = dynamic(() => import("../TestsetDropdown"), {ssr: false})

type PlaygroundHeaderProps = BaseContainerProps

/** Entity types that represent evaluator downstream nodes */
const EVALUATOR_ENTITY_TYPES = ["workflow"]

// Build/Chat switch parked (not removed): Build is the only reachable mode until this flips back.
const SHOW_MODE_SWITCH = false

// Build/Chat switch parked (not removed): Build is the only reachable mode until this flips back.

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

    // Revision entities are often named after their variant ("default"), so
    // prefer the parent evaluator workflow's name for display.
    const evaluatorName = useAtomValue(
        useMemo(() => evaluatorNameByRevisionAtomFamily(node.entityId), [node.entityId]),
    )

    const label = useMemo(() => {
        const fetchedName = evaluatorName || runnableData?.name?.trim()
        const name = fetchedName || runnableData?.slug?.trim() || "Evaluator"
        const version = runnableData?.version ?? null
        return version != null ? `${name} v${version}` : name
    }, [evaluatorName, runnableData])

    return (
        <span
            className="flex max-w-[160px] items-center gap-1 rounded border border-solid border-colorBorder bg-colorFillQuaternary px-[7px] text-xs leading-5 text-colorText"
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
            <button
                type="button"
                aria-label={`Disconnect ${typeof label === "string" ? label : "evaluator"}`}
                onClick={() => onDisconnect(node.id)}
                className="flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-0 text-inherit opacity-60 hover:opacity-100"
            >
                <X size={10} />
            </button>
        </span>
    )
}

// ---------------------------------------------------------------------------
// PlaygroundHeader
// ---------------------------------------------------------------------------
const PlaygroundHeader: React.FC<PlaygroundHeaderProps> = ({className}) => {
    // ATOM-LEVEL OPTIMIZATION: Use focused atom subscriptions instead of full playground state
    const {displayedEntities} = usePlaygroundLayout()

    // Phase 6.1.1: read from currentWorkflowAtom (resolves both apps and
    // evaluators) instead of currentAppAtom (apps-only — null for evaluators).
    // The is_custom flag still resolves correctly because it's a URI-derived
    // flag that exists on the workflow data regardless of role.
    const currentWorkflow = useAtomValue(currentWorkflowAtom)
    // Local mirror of the agent name so a rename reflects instantly in the header, ahead of the
    // list refetch that the identity card triggers.
    const [displayAgentName, setDisplayAgentName] = useState(currentWorkflow?.name ?? "")
    useEffect(() => {
        setDisplayAgentName(currentWorkflow?.name ?? "")
    }, [currentWorkflow?.name])
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

    // Agent workflows hide the evaluation-flow actions (Compare / Test set /
    // Evaluator / New Evaluation) — those flows aren't wired for agents yet.
    const rootEntityId = useMemo(() => nodes.find((n) => n.depth === 0)?.entityId ?? null, [nodes])
    const nodeIsAgent = useAtomValue(
        useMemo(
            () => (rootEntityId ? isAgentModeAtomFamily(rootEntityId) : atom(false)),
            [rootEntityId],
        ),
    )
    // Loading state of the root revision entity. Critical for the gate below: `nodeIsAgent`
    // reads `workflowType`, which falls back to "completion" until the revision's flags load —
    // so a mid-load agent looks identical to a prompt app. We must not treat "not yet known" as
    // "confirmed prompt".
    const rootEntityQuery = useAtomValue(
        useMemo(() => workflowMolecule.selectors.query(rootEntityId ?? ""), [rootEntityId]),
    )
    // In onboarding the URL is the project playground (no app_id), so `currentWorkflowAtom` is null
    // and the agent name would fall back to a static, non-editable "Agent". Resolve the workflow off
    // the root node instead so the name both renders and stays editable there — but only for a real
    // (persisted) workflow, never a local-draft ephemeral (no backend row to rename).
    const rootWorkflowId = useAtomValue(
        useMemo(() => workflowMolecule.selectors.workflowId(rootEntityId ?? ""), [rootEntityId]),
    )
    const rootArtifactName = useAtomValue(
        useMemo(() => workflowMolecule.selectors.artifactName(rootEntityId ?? ""), [rootEntityId]),
    )
    const renameWorkflowId =
        currentWorkflow?.id ??
        (rootWorkflowId && !isLocalDraftId(rootWorkflowId) ? rootWorkflowId : null)
    const agentName = displayAgentName || rootArtifactName || ""
    // Early app-id signal resolves agent-ness before the heavy node graph loads, so
    // the layout commits to the right chrome up front instead of defaulting to the
    // non-agent stack and unmounting it on reload.
    const earlyAgentState = useAtomValue(playgroundEarlyAgentStateAtom)
    const isAgentWorkflow = nodeIsAgent || earlyAgentState === "agent"
    // Neutral until CONFIRMED prompt: show the eval chrome only when a definitive signal says
    // non-agent — the early app-id query resolved to non-agent, OR the root revision has fully
    // SETTLED (not pending) and isn't an agent. The `!isPending` guard is what prevents the
    // agent-reload flash: without it, `hasRootNode && !nodeIsAgent` is true during the flags-load
    // window (node graph resolved, is_agent not yet loaded) and the eval stack pops in then vanishes.
    const showEvalActions =
        !isAgentWorkflow &&
        (earlyAgentState === "non-agent" ||
            (hasRootNode && !nodeIsAgent && !rootEntityQuery.isPending))

    // Pre-commit onboarding: the playground is the "what do you want to build?" surface, so the
    // Build/Chat mode switch + settings cog are noise (there's nothing to configure or chat yet). They
    // return a beat after commit (`chromeRevealed`), eased in with the rest of the post-commit chrome
    // rather than popping in during the first send.
    const onboarding = useOptionalOnboardingContext()
    const chromeHidden = !!onboarding && !onboarding.chromeRevealed

    // SPIKE(virtuoso): live-tunable virtualization knobs (enable + overscan + row estimate).
    // The whole section is hidden unless the NEXT_PUBLIC_AGENT_CHAT_VIRTUALIZATION env flag is set.
    const virtualizationAvailable = isAgentChatVirtualizationAvailable()
    const virtualize = useAtomValue(agentChatVirtualizeAtom)
    const setVirtualize = useSetAtom(agentChatVirtualizeAtom)
    const overscan = useAtomValue(agentChatOverscanAtom)
    const setOverscan = useSetAtom(agentChatOverscanAtom)
    const itemEstimate = useAtomValue(agentChatItemEstimateAtom)
    const setItemEstimate = useSetAtom(agentChatItemEstimateAtom)

    interface SettingsMenuGroup {
        key: string
        label: string
        children: {
            key: string
            label: string
            checked: boolean
            disabled?: boolean
            onClick: () => void
        }[]
    }
    const settingsMenuItems: SettingsMenuGroup[] = useMemo(
        () => [
            ...(virtualizationAvailable
                ? [
                      {
                          key: "virtualization",
                          label: "Virtualization (spike)",
                          children: [
                              {
                                  key: "virt-enable",
                                  label: "Virtualize messages",
                                  checked: virtualize,
                                  onClick: () => setVirtualize(!virtualize),
                              },
                          ],
                      },
                      {
                          key: "virt-overscan",
                          label: "Overscan",
                          children: AGENT_CHAT_OVERSCAN_OPTIONS.map((option) => ({
                              key: `overscan-${option.value}`,
                              label: option.label,
                              disabled: !virtualize,
                              checked: overscan === option.value,
                              onClick: () => setOverscan(option.value),
                          })),
                      },
                      {
                          key: "virt-estimate",
                          label: "Row estimate",
                          children: AGENT_CHAT_ITEM_ESTIMATE_OPTIONS.map((option) => ({
                              key: `estimate-${option.value}`,
                              label: option.label,
                              disabled: !virtualize,
                              checked: itemEstimate === option.value,
                              onClick: () => setItemEstimate(option.value),
                          })),
                      },
                  ]
                : []),
        ],
        [
            virtualizationAvailable,
            virtualize,
            setVirtualize,
            overscan,
            setOverscan,
            itemEstimate,
            setItemEstimate,
        ],
    )

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

    // Evaluator-only adapter with colored type tags, human filtering, custom revision
    // labels, and workflow metadata ("N versions · date") for the picker rows.
    // splitTypeTag renders the type tag in the row's suffix slot (vertically
    // centered) instead of trailing the name.
    //
    // `lazy`: the adapter + the `evaluatorWorkflowMetaMapAtom` read above sit
    // behind the shared enrichment gate, so they resolve no per-evaluator
    // revisions until the user reaches for this "Add evaluators" picker
    // (`handleActivateEvaluatorPicker`, on pointer-enter/focus). Keeps a plain
    // playground load from firing the batched revision fan-out.
    const evaluatorWorkflowAdapter = useEvaluatorOnlyAdapter(renderWorkflowRevisionLabel, {
        showWorkflowMeta: true,
        splitTypeTag: true,
        lazy: true,
    })
    const activateEvaluatorEnrichment = useSetAtom(activateEvaluatorEnrichmentAtom)
    const handleActivateEvaluatorPicker = useCallback(() => {
        activateEvaluatorEnrichment()
    }, [activateEvaluatorEnrichment])

    // Controlled state for EvaluatorTemplateDropdown
    const [templateDropdownOpen, setTemplateDropdownOpen] = useState(false)

    // Open the evaluator template dropdown (called from EntityPicker's onCreateNew)
    const handleOpenTemplateDropdown = useCallback(() => {
        setTemplateDropdownOpen(true)
    }, [])

    const openEvaluatorDrawer = useSetAtom(openEvaluatorDrawerAtom)
    const playgroundStore = useStore()
    // The root node's `label` can be a raw entity UUID (URL-hydrated nodes get
    // `label: entityId`), so build the display label from entity data instead:
    // "AppName / vN" — the same format the drawer's app picker produces on a
    // manual selection (skip-variant adapter), so the preselected state matches.
    const rootRevisionVersion = useAtomValue(
        useMemo(() => {
            const rootEntityId = nodes.find((node) => node.depth === 0)?.entityId
            return atom((get) => {
                if (!rootEntityId) return null
                const data = get(workflowMolecule.selectors.data(rootEntityId)) as {
                    version?: number | null
                } | null
                return data?.version ?? null
            })
        }, [nodes]),
    )

    const currentAppSelection = useMemo(() => {
        if (currentWorkflowCtx.workflowKind === "evaluator") return undefined

        const rootNode = nodes.find((node) => node.depth === 0)
        if (!rootNode) return undefined

        const appName = currentWorkflow?.name?.trim() || "Application"

        return {
            revisionId: rootNode.entityId,
            label: rootRevisionVersion != null ? `${appName} / v${rootRevisionVersion}` : appName,
        }
    }, [currentWorkflow?.name, currentWorkflowCtx.workflowKind, nodes, rootRevisionVersion])

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

    const leading = currentWorkflow?.flags?.is_custom ? (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" aria-label="Workflow options">
                    <DotsThree size={16} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-[180px]">
                <DropdownMenuItem onSelect={openModal}>
                    <PencilSimple size={16} />
                    Configure workflow
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    ) : undefined

    return (
        <>
            <AgentPageHeader
                className={className}
                leading={leading}
                icon={
                    isAgentWorkflow ? <AgentIconTrigger workflowId={renameWorkflowId} /> : undefined
                }
                title={isAgentWorkflow ? undefined : "Playground"}
                name={
                    isAgentWorkflow ? (
                        renameWorkflowId ? (
                            <AgentNameInline
                                workflowId={renameWorkflowId}
                                name={agentName}
                                onRenamed={setDisplayAgentName}
                            />
                        ) : (
                            agentName || "Agent"
                        )
                    ) : undefined
                }
                revision={
                    isAgentWorkflow && rootEntityId ? (
                        <AgentRevisionSelector variantId={rootEntityId} />
                    ) : undefined
                }
                actions={
                    <>
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
                         * playground doesn't make sense (would evaluate itself).
                         * Agent workflows hide it too (eval flow not wired yet). */}
                        {showEvalActions && currentWorkflowCtx.workflowKind !== "evaluator" && (
                            <RunEvaluationButton />
                        )}
                        {showEvalActions && (
                            <>
                                <span
                                    aria-hidden
                                    className="mx-0 h-5 w-px shrink-0 bg-colorBorderSecondary"
                                />
                                <span
                                    className="relative inline-flex"
                                    onPointerEnter={handleActivateEvaluatorPicker}
                                    onFocus={handleActivateEvaluatorPicker}
                                >
                                    <SimpleTooltip title="Add evaluators to automatically score outputs in the playground.">
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
                                                panelWidth={320}
                                                childPanelWidth={180}
                                                openChildOnHover
                                                showParentCheckboxes
                                                selectedChildrenByParent={selectedChildrenByParent}
                                                totalChildrenByParent={totalChildrenByParent}
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
                                                                variant="destructive-outline"
                                                                size="sm"
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
                                    </SimpleTooltip>
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
                                    <SimpleTooltip title="Compare mode is unavailable in project-level playground">
                                        <span className="inline-flex">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                disabled
                                                className="rounded-r-none"
                                            >
                                                <Plus size={14} />
                                                Compare
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="icon-sm"
                                                disabled
                                                aria-label="Compare options"
                                                className="-ml-px rounded-l-none"
                                            >
                                                <CaretDown size={10} />
                                            </Button>
                                        </span>
                                    </SimpleTooltip>
                                ) : (
                                    <SelectVariant
                                        showAsCompare
                                        multiple
                                        onChange={(value) => onAddVariant(value)}
                                        value={displayedEntities}
                                    />
                                )}
                            </>
                        )}
                        {isAgentWorkflow && !chromeHidden && (
                            <>
                                {/* Build/Chat switch parked (not removed): Build is the only
                                    reachable mode until this flips back. 112.0 shipped it behind
                                    this same `false` and 112.1 kept it there; the package
                                    extraction rendered it unconditionally, which put a second
                                    "hide the config pane" affordance next to the « collapse
                                    control that PR #5943 designed as the only one. */}
                                {SHOW_MODE_SWITCH && <PlaygroundModeSwitch />}
                                {settingsMenuItems.length > 0 && (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                aria-label="Playground settings"
                                            >
                                                <GearSix size={16} />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-[200px]">
                                            {settingsMenuItems.map((group, index) => (
                                                <React.Fragment key={group.key}>
                                                    {index > 0 ? <DropdownMenuSeparator /> : null}
                                                    <DropdownMenuLabel>
                                                        {group.label}
                                                    </DropdownMenuLabel>
                                                    {group.children.map((item) => (
                                                        <DropdownMenuItem
                                                            key={item.key}
                                                            disabled={item.disabled}
                                                            onSelect={item.onClick}
                                                        >
                                                            {item.checked ? (
                                                                <Check size={14} />
                                                            ) : (
                                                                <span className="inline-block w-[14px]" />
                                                            )}
                                                            {item.label}
                                                        </DropdownMenuItem>
                                                    ))}
                                                </React.Fragment>
                                            ))}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                )}
                            </>
                        )}
                    </>
                }
            />
        </>
    )
}

export default PlaygroundHeader
