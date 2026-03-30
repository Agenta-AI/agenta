import {memo, useCallback, useRef, type ReactNode} from "react"

import type {ConfigViewMode} from "@agenta/entity-ui"
import {
    executionController,
    executionItemController,
    playgroundController,
} from "@agenta/playground"
import {EmptyState, ExecutionHeader, useEntitySelector} from "@agenta/playground-ui/components"
import {
    GenerationComparisonOutput,
    GenerationComparisonOutputHeader,
    GenerationComparisonInputHeader as PlaygroundComparisonGenerationInputHeader,
} from "@agenta/playground-ui/execution-item-comparison-view"
import ExecutionItems from "@agenta/playground-ui/execution-items"
import {Button, Splitter, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {routerAppIdAtom} from "@/oss/state/app/selectors/app"

import {usePlaygroundScrollSync} from "../../hooks/usePlaygroundScrollSync"
import PromptComparisonVariantNavigation from "../PlaygroundPromptComparisonView/PromptComparisonVariantNavigation"
import PlaygroundVariantConfig from "../PlaygroundVariantConfig"
import type {BaseContainerProps} from "../types"
const PlaygroundFocusDrawer = dynamic(
    () => import("@agenta/playground-ui/components").then((m) => m.PlaygroundFocusDrawer),
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
}

const SplitterPanel = Splitter.Panel

const GenerationPanelPlaceholder = memo(() => (
    <div className="p-4">
        <div className="h-[180px] rounded-lg border border-solid border-[rgba(5,23,41,0.08)] bg-white" />
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
    ...divProps
}: MainLayoutProps) => {
    const selectedEntityIds = useAtomValue(playgroundController.selectors.entityIds())
    const displayedEntities = useAtomValue(playgroundController.selectors.displayedEntityIds())
    const status = useAtomValue(playgroundController.selectors.status())
    const urlAppId = useAtomValue(routerAppIdAtom)
    const {open: openEntitySelector} = useEntitySelector()
    const setEntityIds = playgroundController.actions.setEntityIds

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
    const showEmptyState = isEmpty && (isProjectLevel || isEvaluatorMode)
    const showErrorState = isEmpty && !isProjectLevel && !isEvaluatorMode

    // Which entity IDs to render config panels for
    const configEntityIds = configEntityIdsOverride ?? layoutEntityIds

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
            // Add the selected entity to the playground
            const store = (await import("jotai")).getDefaultStore()
            store.set(setEntityIds, [selection.id])
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
            <div className="w-full max-h-full h-full grow relative overflow-hidden">
                <Splitter
                    key={`${isComparisonView ? "comparison" : "single"}-splitter`}
                    className="h-full playground-splitter"
                    orientation={isComparisonView ? "vertical" : "horizontal"}
                >
                    <SplitterPanel
                        defaultSize="50%"
                        min="20%"
                        max="70%"
                        className="!h-full"
                        collapsible
                        key={`${isComparisonView ? "comparison" : "single"}-splitter-panel-config`}
                    >
                        <section
                            ref={setConfigPanelRef}
                            className={clsx([
                                {
                                    "grow w-full h-full overflow-y-auto": !isComparisonView,
                                    "grow w-full h-full overflow-x-auto flex [&::-webkit-scrollbar]:w-0":
                                        isComparisonView,
                                },
                            ])}
                        >
                            <>
                                {isComparisonView && hasDisplayedEntities && (
                                    <PromptComparisonVariantNavigation
                                        className="[&::-webkit-scrollbar]:w-0 w-[400px] sticky left-0 z-10 h-full overflow-y-auto overflow-x-hidden flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)] bg-white"
                                        handleScroll={handleScroll}
                                    />
                                )}
                                {configEntityIds.length > 0 ? (
                                    configEntityIds.map((variantId, index) => (
                                        <div
                                            key={`variant-config-${variantId}`}
                                            className={clsx([
                                                {
                                                    "[&::-webkit-scrollbar]:w-0 min-w-[400px] flex-1 h-full max-h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)] relative":
                                                        isComparisonView,
                                                },
                                            ])}
                                            ref={(el) => {
                                                variantRefs.current[index] = el
                                            }}
                                        >
                                            <PlaygroundVariantConfig
                                                variantId={variantId}
                                                externalViewMode={configViewMode}
                                                onViewModeChange={onConfigViewModeChange}
                                            />
                                        </div>
                                    ))
                                ) : (
                                    <div className="h-full w-full p-4">
                                        <div className="h-[260px] rounded-lg border border-solid border-[rgba(5,23,41,0.08)] bg-white" />
                                    </div>
                                )}
                            </>
                        </section>
                    </SplitterPanel>

                    <SplitterPanel
                        className={clsx("!h-full @container", {
                            "!overflow-y-hidden flex flex-col": isComparisonView,
                        })}
                        collapsible
                        defaultSize="50%"
                        key={`${isComparisonView ? "comparison" : "single"}-splitter-panel-runs`}
                    >
                        {isComparisonView && <ExecutionHeader />}
                        <section
                            ref={setGenerationPanelRef}
                            className={clsx([
                                "playground-generation",
                                {
                                    "grow w-full h-full overflow-y-auto": !isComparisonView,
                                    "grow w-full h-full overflow-auto [&::-webkit-scrollbar]:w-0":
                                        isComparisonView,
                                },
                            ])}
                        >
                            {/* This component renders Output component header section */}
                            {isComparisonView ? (
                                <div className="flex min-w-fit sticky top-0 z-[5]">
                                    <PlaygroundComparisonGenerationInputHeader className="!w-[400px] shrink-0 sticky left-0 top-0 z-[99] bg-white" />

                                    {layoutEntityIds.map((variantId) => (
                                        <GenerationComparisonOutputHeader
                                            key={variantId}
                                            entityId={variantId}
                                            className="!min-w-[400px] flex-1 shrink-0"
                                        />
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
                                layoutEntityIds.map((variantId) =>
                                    displayedEntities.includes(variantId) || isEvaluatorMode ? (
                                        <ExecutionItems key={variantId} entityId={variantId} />
                                    ) : (
                                        <GenerationPanelPlaceholder
                                            key={`generation-placeholder-${variantId}`}
                                        />
                                    ),
                                )
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
