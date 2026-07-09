import {memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import type {ConfigViewMode} from "@agenta/entity-ui"
import {
    executionController,
    executionItemController,
    isAgentModeAtomFamily,
    playgroundController,
} from "@agenta/playground"
import {EmptyState, ExecutionHeader, useEntitySelector} from "@agenta/playground-ui/components"
import ExecutionItems, {
    type PlaygroundGenerationsProps,
} from "@agenta/playground-ui/execution-items"
import {Button, Splitter, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import AgentChatSkeleton from "@/oss/components/AgentChatSlice/components/AgentChatSkeleton"
import {chatPanelMaximizedAtom} from "@/oss/components/AgentChatSlice/state/panelLayout"
// Direct file import — the SessionInspector barrel would statically pull the (dynamic,
// open-on-demand) inspector drawer back into this chunk.
import PanelSessionInspectorButton from "@/oss/components/SessionInspector/PanelSessionInspectorButton"
import {routerAppIdAtom} from "@/oss/state/app/selectors/app"
import {playgroundEarlyAgentStateAtom} from "@/oss/state/workflow"

import {usePlaygroundScrollSync} from "../../hooks/usePlaygroundScrollSync"
import PlaygroundVariantConfig from "../PlaygroundVariantConfig"
import type {BaseContainerProps} from "../types"
const PlaygroundFocusDrawer = dynamic(() => import("../PlaygroundFocusDrawerAdapter"), {
    ssr: false,
})

// The comparison view only mounts with 2+ selected entities — never for agents, and
// rarely at first paint — so its whole subtree loads on demand.
const GenerationComparisonOutput = dynamic(
    () =>
        import("@agenta/playground-ui/execution-item-comparison-view").then(
            (m) => m.GenerationComparisonOutput,
        ),
    {ssr: false},
)
const GenerationComparisonOutputHeader = dynamic(
    () =>
        import("@agenta/playground-ui/execution-item-comparison-view").then(
            (m) => m.GenerationComparisonOutputHeader,
        ),
    {ssr: false},
)
const PlaygroundComparisonGenerationInputHeader = dynamic(
    () =>
        import("@agenta/playground-ui/execution-item-comparison-view").then(
            (m) => m.GenerationComparisonInputHeader,
        ),
    {ssr: false},
)
const PromptComparisonVariantNavigation = dynamic(
    () => import("../PlaygroundPromptComparisonView/PromptComparisonVariantNavigation"),
    {ssr: false},
)

type MainLayoutProps = BaseContainerProps & {
    /** "app" (default) = standard app playground. "evaluator" = evaluator config playground. */
    mode?: "app" | "evaluator"
    /** "full" (default) = splitter with config + execution panels. "configOnly" = config panel only, no splitter/execution. */
    viewMode?: "full" | "configOnly"
    /** Override which entity IDs render config panels. When set, these IDs are used for the left panel instead of the depth-0 layout entity IDs. */
    configEntityIdsOverride?: string[]
    /** When true, the execution panel shows a placeholder instead of run controls. */
    runDisabled?: boolean
    /** Custom content to render in the run-disabled placeholder. When omitted, a default message is shown. */
    runDisabledContent?: ReactNode
    /** When true, hides entity selector and shows variant name inline. Used when rendering inside a drawer. */
    embedded?: boolean
    /** Externally controlled config view mode (form/json/yaml). */
    configViewMode?: ConfigViewMode
    /** Callback when config view mode changes. */
    onConfigViewModeChange?: (mode: ConfigViewMode) => void
    /** Render slot for testset menu in the per-entity Generations header (single view). */
    renderTestsetActions?: PlaygroundGenerationsProps["renderTestsetActions"]
    /**
     * Replaces the config-panel content (the per-variant config forms) with custom content, keeping
     * the panel's splitter/scroll/raised-surface chrome. Single-view only. Used by playground-native
     * onboarding to show the templates list while the agent is still ephemeral. Omit for the normal
     * config forms.
     */
    renderConfigOverride?: ReactNode
}

const SplitterPanel = Splitter.Panel

const GenerationPanelPlaceholder = memo(() => (
    <div className="p-4">
        <div className="h-[180px] rounded-lg border border-solid border-[var(--ag-rgba-051729-08)] bg-[var(--ag-c-FFFFFF)]" />
    </div>
))

const GenerationComparisonRenderer = memo(() => {
    // Unified render model: grouped execution items by row
    const rows = useAtomValue(executionItemController.selectors.renderableRows)
    const isChat = useAtomValue(executionController.selectors.isChatMode)

    if (isChat === undefined) return null

    return (rows || []).map((row) => (
        <div key={row.rowId} className="flex flex-col">
            <div className="min-w-fit">
                <GenerationComparisonOutput
                    key={row.rowId}
                    rowId={row.rowId}
                    isFirstRow={row.isFirstRow}
                    isLastRow={row.isLastRow}
                />
            </div>
        </div>
    ))
})

const RunDisabledPlaceholder = memo(({children}: {children?: ReactNode}) => (
    <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
        {children ?? (
            <Typography.Text type="secondary" className="text-sm">
                Select an app workflow to run the evaluator chain
            </Typography.Text>
        )}
    </div>
))

const PlaygroundMainView = ({
    className,
    mode = "app",
    viewMode = "full",
    configEntityIdsOverride,
    runDisabled = false,
    runDisabledContent,
    embedded = false,
    configViewMode,
    onConfigViewModeChange,
    renderTestsetActions,
    renderConfigOverride,
    ...divProps
}: MainLayoutProps) => {
    const selectedEntityIds = useAtomValue(playgroundController.selectors.entityIds())
    const displayedEntities = useAtomValue(playgroundController.selectors.displayedEntityIds())
    const status = useAtomValue(playgroundController.selectors.status())
    const urlAppId = useAtomValue(routerAppIdAtom)
    const {open: openEntitySelector} = useEntitySelector()
    const setEntityIds = useSetAtom(playgroundController.actions.setEntityIds)

    const isEvaluatorMode = mode === "evaluator"
    const layoutEntityIds = selectedEntityIds.length > 0 ? selectedEntityIds : displayedEntities
    // In evaluator mode, comparison is always disabled
    const isComparisonView = !isEvaluatorMode && layoutEntityIds.length > 1
    const hasAnyLayoutEntity = layoutEntityIds.length > 0
    const hasDisplayedEntities = displayedEntities.length > 0
    const isEmpty = status === "empty"
    // On project-level playground (no app in URL), show empty state instead of error
    // when no entities are selected. Evaluator mode always uses empty state (no URL app).
    const isProjectLevel = !urlAppId
    // A caller-provided config override (playground-native onboarding: templates while ephemeral)
    // supplies its own content, so never fall back to the "add an app revision" empty state — an
    // ephemeral `local-*` entity never resolves to a backend revision, so `status` stays "empty" even
    // though we do have a (local) entity to render. The drawer sidesteps the same way via !isProjectLevel.
    const showEmptyState = isEmpty && (isProjectLevel || isEvaluatorMode) && !renderConfigOverride
    const showErrorState = isEmpty && !isProjectLevel && !isEvaluatorMode

    // Which entity IDs to render config panels for
    const configEntityIds = configEntityIdsOverride ?? layoutEntityIds

    // ── Agent generation host: keep a stable key across revision switches ──
    // The agent chat surface lives inside the generation panel below. Keying that panel by the
    // revision id (`variantId`) tears the whole conversation down on every revision switch —
    // whether the agent self-commits a new revision or the user picks one in the config header —
    // which aborts the live stream ("connection lost") and drops the still-streaming turn
    // (persistence is skipped mid-stream). Agents are single-entity (excluded from comparison),
    // so we give the single-agent generation panel a stable key; a switch then flows through as an
    // `entityId` prop update, not a remount, and the conversation (app/session-scoped) survives.
    // A freshly committed revision's flags load a beat after the swap (workflowType falls back to
    // "completion" until then), so we LATCH the agent host across that gap and only drop it once
    // the single entity has loaded as a definitively non-agent workflow.
    const singleEntityId =
        !isComparisonView && layoutEntityIds.length === 1 ? layoutEntityIds[0]! : ""
    const isSingleAgentEntity = useAtomValue(isAgentModeAtomFamily(singleEntityId))
    const singleEntityQuery = useAtomValue(
        useMemo(() => workflowMolecule.selectors.query(singleEntityId), [singleEntityId]),
    )
    const agentHostRef = useRef(false)
    if (!singleEntityId) {
        agentHostRef.current = false
    } else if (isSingleAgentEntity) {
        agentHostRef.current = true
    } else if (!singleEntityQuery.isPending) {
        agentHostRef.current = false
    }
    const renderAgentGenerationHost = agentHostRef.current

    // The agent config panel is a compact read-only summary (editing happens in section drawers), so
    // it stays narrow (~440px) instead of the prompt config's 50/50 split. The default is a fixed px
    // width rather than a percentage on purpose: antd applies `defaultSize` verbatim at mount and only
    // clamps to `min`/`max` while dragging, so a percentage default would blow past the px cap on load.
    // Only applies to a single agent variant. `isAgentConfig` resolves once the revision loads, so it
    // is folded into the Splitter `key` below — antd reads `defaultSize` only at mount, and without a
    // key change the panel would keep the initial (pre-resolution) 50% split on reload.
    const primaryConfigId =
        !isComparisonView && configEntityIds.length > 0 ? configEntityIds[0]! : ""
    // Seed the agent geometry from the early app-id signal so the splitter mounts at the
    // 440px agent split instead of flashing the prompt 50/50 while the revision loads.
    // Single-view only (agents are excluded from comparison); the per-entity value still
    // wins once the config revision resolves.
    const earlyIsAgent = useAtomValue(playgroundEarlyAgentStateAtom) === "agent"
    const isAgentConfig =
        useAtomValue(isAgentModeAtomFamily(primaryConfigId)) || (!isComparisonView && earlyIsAgent)
    // Agent max = default on purpose: the summary panel mounts at its cap, so the drag handle only
    // shrinks it. (A larger max just teased a few px of "expansion" — antd counts px sizes against
    // the full container INCLUDING the 12px gutter bar, whose overflow flex-shrink taxes both
    // panels, so the panel never even reached the old 450.)
    const configDefaultSize = isAgentConfig ? 440 : "50%"
    const configMaxSize = isAgentConfig ? 440 : "70%"
    // Let the runs panel auto-fill in agent mode. A px config default + a "50%" runs default
    // don't sum to 100%, so antd scales BOTH up to fill the container — pushing config past its
    // px max on mount, which then snaps down on the first drag. An undefined runs default fills
    // the remainder without scaling config, so it mounts at exactly `configDefaultSize`.
    const runsDefaultSize = isAgentConfig ? undefined : "50%"
    const splitterKey = `${isComparisonView ? "comparison" : "single"}-${isAgentConfig ? "agent" : "std"}`
    // Mode switching is the header Build/Chat control, so the splitter's own collapse/expand
    // handles are redundant on the agent playground — disable `collapsible` on both panes (keeping
    // drag-resize). Prompt playgrounds keep antd's default collapse affordances.
    const splitCollapsible = !isAgentConfig
    // Chat-panel maximize toggle (button lives in the chat header). Controlling the config
    // panel's `size` puts antd's Splitter into controlled mode: 0 collapses it, undefined
    // restores uncontrolled drag/defaultSize behaviour. Only meaningful in single agent view.
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)
    const configCollapsed = !isComparisonView && isAgentConfig && chatMaximized
    // Ease the config pane between its width and 0 on a Build/Chat toggle. The transition class must
    // land in the SAME commit as the size change (else it snaps), so detect the flip during render
    // via a ref compare; hold it ~280ms so removing the class doesn't snap, then drop it (mount,
    // drag, and window resize keep it off so the panes never lag their target size).
    const prevMaximizedRef = useRef(chatMaximized)
    const [holdAnimate, setHoldAnimate] = useState(false)
    const justToggled = prevMaximizedRef.current !== chatMaximized
    // Deps = toggle value ONLY: with `justToggled` in deps, the holdAnimate re-render re-ran the
    // effect and its cleanup cancelled the timer — the class stuck on and every drag lagged.
    useEffect(() => {
        if (prevMaximizedRef.current === chatMaximized) return
        prevMaximizedRef.current = chatMaximized
        setHoldAnimate(true)
        const t = setTimeout(() => setHoldAnimate(false), 280)
        return () => clearTimeout(t)
    }, [chatMaximized])
    const animateSplit = justToggled || holdAnimate

    const variantRefs = useRef<(HTMLDivElement | null)[]>([])
    const {setConfigPanelRef, setGenerationPanelRef} = usePlaygroundScrollSync({
        enabled: isComparisonView,
    })

    const handleAddRunnable = useCallback(async () => {
        const selection = await openEntitySelector({
            title: "Add to Playground",
            allowedTypes: ["workflow"],
        })
        if (selection) {
            setEntityIds([selection.id])
        }
    }, [openEntitySelector, setEntityIds])

    // Selection validation and default selection are now handled imperatively
    // by playgroundSyncAtom (store.sub subscriptions in playground.ts)

    const handleScroll = useCallback(
        (index: number) => {
            const targetRef = variantRefs.current[index]

            if (targetRef) {
                targetRef.scrollIntoView({behavior: "smooth", inline: "end"})
            }
        },
        [variantRefs],
    )

    if (showEmptyState) {
        return (
            <main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
                <EmptyState onAddRunnable={handleAddRunnable} />
            </main>
        )
    }

    if (showErrorState) {
        return (
            <main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
                <div className="flex flex-col items-center justify-center gap-1">
                    <Typography.Title level={3}>Something went wrong</Typography.Title>
                    <Typography.Text className="mb-3 text-[14px]">
                        Playground is unable to communicate with the service
                    </Typography.Text>
                    <Button>Try again</Button>
                </div>
            </main>
        )
    }

    if (viewMode === "configOnly") {
        return (
            <main
                className={clsx("flex flex-col grow h-full overflow-hidden", className)}
                {...divProps}
            >
                <div className="w-full h-full overflow-y-auto overflow-x-hidden">
                    {configEntityIds.map((variantId) => (
                        <PlaygroundVariantConfig
                            key={variantId}
                            variantId={variantId}
                            embedded={embedded}
                            externalViewMode={configViewMode}
                            onViewModeChange={onConfigViewModeChange}
                        />
                    ))}
                </div>
            </main>
        )
    }

    return (
        <main
            className={clsx("flex flex-col grow h-full overflow-hidden", className)}
            {...divProps}
        >
            <div
                className={clsx("w-full max-h-full h-full grow relative overflow-hidden", {
                    // Agent Build view: recess the whole workspace to a near-black/soft-grey base so
                    // the raised Config panel and the Chat canvas read as two distinct surfaces.
                    "ag-app-ground": isAgentConfig,
                })}
            >
                <Splitter
                    key={`${splitterKey}-splitter`}
                    className={clsx("h-full playground-splitter", {
                        // Agent mode has no collapse pill (Build/Chat lives in the header), so the
                        // drag handle needs its own discoverability treatment (a visible grip).
                        "playground-splitter-agent": isAgentConfig,
                        "playground-splitter-collapsed": configCollapsed,
                        "playground-splitter-animated": animateSplit,
                    })}
                    orientation={isComparisonView ? "vertical" : "horizontal"}
                >
                    <SplitterPanel
                        defaultSize={configDefaultSize}
                        size={configCollapsed ? 0 : undefined}
                        min="20%"
                        max={configMaxSize}
                        className="!h-full"
                        collapsible={splitCollapsible}
                        key={`${splitterKey}-splitter-panel-config`}
                    >
                        <section
                            ref={setConfigPanelRef}
                            className={clsx([
                                {
                                    "grow w-full h-full overflow-y-auto": !isComparisonView,
                                    "grow w-full h-full overflow-x-auto flex [&::-webkit-scrollbar]:w-0":
                                        isComparisonView,
                                    // Config = the raised authoring surface.
                                    "ag-panel-raised": isAgentConfig,
                                },
                            ])}
                        >
                            <>
                                {isComparisonView && hasDisplayedEntities && (
                                    <PromptComparisonVariantNavigation
                                        className="[&::-webkit-scrollbar]:w-0 w-[400px] sticky left-0 z-10 h-full overflow-y-auto overflow-x-hidden flex-shrink-0 border-0 border-r border-solid border-[var(--ag-rgba-051729-06)] bg-[var(--ag-c-FFFFFF)]"
                                        handleScroll={handleScroll}
                                    />
                                )}
                                {renderConfigOverride && !isComparisonView ? (
                                    renderConfigOverride
                                ) : configEntityIds.length > 0 ? (
                                    configEntityIds.map((variantId, index) => (
                                        <div
                                            // Agents get a STABLE key (like the chat host): a
                                            // self-commit switches the revision in place, so the
                                            // config panel must update as a prop change — a remount
                                            // replays the sections' collapsed→open entrance.
                                            key={
                                                renderAgentGenerationHost
                                                    ? "agent-config-host"
                                                    : `variant-config-${variantId}`
                                            }
                                            className={clsx([
                                                {
                                                    "[&::-webkit-scrollbar]:w-0 min-w-[400px] flex-1 h-full max-h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[var(--ag-rgba-051729-06)] relative":
                                                        isComparisonView,
                                                },
                                            ])}
                                            ref={(el) => {
                                                variantRefs.current[index] = el
                                            }}
                                        >
                                            <PlaygroundVariantConfig
                                                variantId={variantId}
                                                embedded={embedded}
                                                externalViewMode={configViewMode}
                                                onViewModeChange={onConfigViewModeChange}
                                            />
                                        </div>
                                    ))
                                ) : (
                                    <div className="h-full w-full p-4">
                                        <div className="h-[260px] rounded-lg border border-solid border-[var(--ag-rgba-051729-08)] bg-[var(--ag-c-FFFFFF)]" />
                                    </div>
                                )}
                            </>
                        </section>
                    </SplitterPanel>

                    <SplitterPanel
                        className={clsx("!h-full @container min-w-0", {
                            "!overflow-y-hidden flex flex-col": isComparisonView,
                        })}
                        collapsible={splitCollapsible}
                        defaultSize={runsDefaultSize}
                        key={`${isComparisonView ? "comparison" : "single"}-splitter-panel-runs`}
                    >
                        {isComparisonView && <ExecutionHeader />}
                        <section
                            ref={setGenerationPanelRef}
                            className={clsx([
                                "playground-generation",
                                {
                                    "grow w-full h-full overflow-y-auto overflow-x-hidden":
                                        !isComparisonView,
                                    "grow w-full h-full overflow-auto [&::-webkit-scrollbar]:w-0":
                                        isComparisonView,
                                    // Chat = the recessed canvas the message/composer surfaces sit on.
                                    "ag-canvas": isAgentConfig,
                                },
                            ])}
                        >
                            {/* This component renders Output component header section */}
                            {isComparisonView ? (
                                <div className="flex min-w-fit sticky top-0 z-[5]">
                                    <PlaygroundComparisonGenerationInputHeader className="!w-[400px] shrink-0 sticky left-0 top-0 z-[99] bg-[var(--ag-c-FFFFFF)]" />

                                    {layoutEntityIds.map((variantId) => (
                                        <div
                                            key={variantId}
                                            className="relative !min-w-[400px] flex-1 shrink-0"
                                        >
                                            <GenerationComparisonOutputHeader
                                                entityId={variantId}
                                                className="w-full"
                                            />
                                            <div className="absolute right-2 top-1/2 -translate-y-1/2 z-[6]">
                                                <PanelSessionInspectorButton entityId={variantId} />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {/* ATOM-LEVEL OPTIMIZATION: Execution-item components using focused atom subscriptions
                            Comparison view: Uses renderableExecutionRows for row grouping
                            Single view: Uses displayedEntities for per-execution panels */}
                            {runDisabled ? (
                                <RunDisabledPlaceholder>
                                    {runDisabledContent}
                                </RunDisabledPlaceholder>
                            ) : !hasAnyLayoutEntity ? (
                                <GenerationPanelPlaceholder />
                            ) : isComparisonView && hasDisplayedEntities ? (
                                <GenerationComparisonRenderer />
                            ) : (
                                layoutEntityIds.map((variantId) => {
                                    // Single-agent view: a stable key so a revision switch updates
                                    // the entityId prop instead of remounting the live conversation.
                                    // Rendered unconditionally (not gated on `displayedEntities`) so
                                    // it can't blink to the placeholder during the atomic id swap.
                                    if (renderAgentGenerationHost) {
                                        return (
                                            <ExecutionItems
                                                key="agent-generation-host"
                                                entityId={variantId}
                                                renderTestsetActions={renderTestsetActions}
                                            />
                                        )
                                    }
                                    // Agent identified early (persisted agent-type map) but the
                                    // revision hasn't resolved the flag yet — hold the chat pane's
                                    // shape instead of a blank canvas until the host mounts.
                                    if (isAgentConfig && singleEntityQuery.isPending) {
                                        return <AgentChatSkeleton key="agent-generation-skeleton" />
                                    }
                                    return displayedEntities.includes(variantId) ||
                                        isEvaluatorMode ? (
                                        <ExecutionItems
                                            key={variantId}
                                            entityId={variantId}
                                            renderTestsetActions={renderTestsetActions}
                                        />
                                    ) : (
                                        <GenerationPanelPlaceholder
                                            key={`generation-placeholder-${variantId}`}
                                        />
                                    )
                                })
                            )}
                        </section>
                    </SplitterPanel>
                </Splitter>
                <PlaygroundFocusDrawer />
            </div>
        </main>
    )
}

export default memo(PlaygroundMainView)
