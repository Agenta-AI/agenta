import {memo, useCallback, useEffect, useRef} from "react"

import {Button, Splitter, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {generationInputRowIdsAtom} from "@/oss/components/Playground/state/atoms/generationProperties"
import {chatTurnIdsAtom} from "@/oss/state/generation/entities"
import {writePlaygroundSelectionToQuery} from "@/oss/state/url/playground"
import {appStatusAtom} from "@/oss/state/variant/atoms/appStatus"
import {appStatusLoadingAtom} from "@/oss/state/variant/atoms/fetcher"
import {revisionListAtom} from "@/oss/state/variant/selectors/variant"

import {usePlaygroundScrollSync} from "../../hooks/usePlaygroundScrollSync"
import {
    appChatModeAtom,
    displayedVariantsAtom,
    isComparisonViewAtom,
    selectedVariantsAtom,
} from "../../state/atoms"
import {GenerationComparisonOutput} from "../PlaygroundGenerationComparisonView"
import PlaygroundComparisonGenerationInputHeader from "../PlaygroundGenerationComparisonView/assets/GenerationComparisonInputHeader/index."
import GenerationComparisonOutputHeader from "../PlaygroundGenerationComparisonView/assets/GenerationComparisonOutputHeader"
import GenerationComparisonHeader from "../PlaygroundGenerationComparisonView/GenerationComparisonHeader"
import PlaygroundGenerations from "../PlaygroundGenerations"
import PromptComparisonVariantNavigation from "../PlaygroundPromptComparisonView/PromptComparisonVariantNavigation"
import PlaygroundVariantConfig from "../PlaygroundVariantConfig"
import type {BaseContainerProps} from "../types"
const PlaygroundFocusDrawer = dynamic(() => import("../Drawers/FocusDrawer"), {
    ssr: false,
})

import ComparisonVariantConfigSkeleton from "./assets/ComparisonVariantConfigSkeleton"
import ComparisonVariantNavigationSkeleton from "./assets/ComparisonVariantNavigationSkeleton"
import GenerationPanelSkeleton from "./assets/GenerationPanelSkeleton"

interface MainLayoutProps extends BaseContainerProps {
    isLoading?: boolean
}

const SplitterPanel = Splitter.Panel

const arraysEqual = (a: string[], b: string[]) => {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
        if (a[i] !== b[i]) return false
    }
    return true
}

const GenerationComparisonRenderer = memo(() => {
    // Variables rows (inputs) and logical chat turn ids
    const rowIds = useAtomValue(generationInputRowIdsAtom)
    const turnIds = useAtomValue(chatTurnIdsAtom)
    const isChat = useAtomValue(appChatModeAtom)

    if (isChat === undefined) return null

    const sourceIds = isChat ? turnIds : rowIds

    return (sourceIds || []).map((rowId, rowIndex) => (
        <div key={rowId} className="flex flex-col">
            <div className="min-w-fit">
                <GenerationComparisonOutput
                    key={rowId}
                    rowId={rowId}
                    isFirstRow={rowIndex === 0}
                    isLastRow={rowIndex === (sourceIds?.length || 0) - 1}
                />
            </div>
        </div>
    ))
})

const PlaygroundMainView = ({className, isLoading = false, ...divProps}: MainLayoutProps) => {
    const isComparisonView = useAtomValue(isComparisonViewAtom)
    const displayedVariants = useAtomValue(displayedVariantsAtom)
    const selectedVariants = useAtomValue(selectedVariantsAtom)
    const revisionList = useAtomValue(revisionListAtom)
    const setSelectedVariants = useSetAtom(selectedVariantsAtom)

    const appStatus = useAtomValue(appStatusAtom)
    const appStatusLoading = useAtomValue(appStatusLoadingAtom)

    const hasDisplayedVariantIds = displayedVariants && displayedVariants.length > 0

    // Only show skeleton when we don't have variant IDs yet (very early loading)
    // Once we have IDs, render the components and let them handle their own loading
    const shouldShowVariantConfigSkeleton =
        appStatusLoading || (isLoading && !hasDisplayedVariantIds)
    const shouldShowGenerationSkeleton = appStatusLoading || (isLoading && !hasDisplayedVariantIds)
    const notReachable = !appStatusLoading && !appStatus
    const variantRefs = useRef<(HTMLDivElement | null)[]>([])
    const {setConfigPanelRef, setGenerationPanelRef} = usePlaygroundScrollSync({
        enabled: isComparisonView,
    })

    useEffect(() => {
        if (process.env.NODE_ENV !== "production") {
            console.info("[PlaygroundMainView] state", {
                displayedVariants,
                isComparisonView,
                shouldShowVariantConfigSkeleton,
                shouldShowGenerationSkeleton,
                appStatus,
                appStatusLoading,
            })
        }
    }, [
        displayedVariants,
        isComparisonView,
        shouldShowVariantConfigSkeleton,
        shouldShowGenerationSkeleton,
        appStatus,
        appStatusLoading,
    ])

    useEffect(() => {
        if (appStatusLoading) return
        if (!Array.isArray(revisionList) || revisionList.length === 0) return

        const revisionIds = new Set(revisionList.map((revision) => revision?.id).filter(Boolean))
        const validSelection = selectedVariants.filter((id) => revisionIds.has(id))
        const nextSelection =
            validSelection.length > 0 ? validSelection : [revisionList[0]?.id].filter(Boolean)

        if (nextSelection.length === 0 || arraysEqual(nextSelection, selectedVariants)) return

        setSelectedVariants(nextSelection)
        void writePlaygroundSelectionToQuery(nextSelection)
    }, [appStatusLoading, revisionList, selectedVariants, setSelectedVariants])

    const handleScroll = useCallback(
        (index: number) => {
            const targetRef = variantRefs.current[index]

            if (targetRef) {
                targetRef.scrollIntoView({behavior: "smooth", inline: "end"})
            }
        },
        [variantRefs],
    )

    return notReachable ? (
        <main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
            <div className="flex flex-col items-center justify-center gap-1">
                <Typography.Title level={3}>Something went wrong</Typography.Title>
                <Typography.Text className="mb-3 text-[14px]">
                    Playground is unable to communicate with the service
                </Typography.Text>
                <Button>Try again</Button>
            </div>
        </main>
    ) : (
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
                            {isComparisonView &&
                                (shouldShowVariantConfigSkeleton ? (
                                    <ComparisonVariantNavigationSkeleton />
                                ) : (
                                    <PromptComparisonVariantNavigation
                                        className="[&::-webkit-scrollbar]:w-0 w-[400px] sticky left-0 z-10 h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)] bg-white"
                                        handleScroll={handleScroll}
                                    />
                                ))}
                            {shouldShowVariantConfigSkeleton ? (
                                <ComparisonVariantConfigSkeleton
                                    count={2}
                                    isComparisonView={isComparisonView}
                                />
                            ) : (
                                (displayedVariants || []).map((variant, index) => {
                                    // Handle both object and string cases for displayedVariants
                                    const variantId =
                                        typeof variant === "string" ? variant : variant?.id

                                    return (
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
                                            <PlaygroundVariantConfig variantId={variantId} />
                                        </div>
                                    )
                                })
                            )}
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
                        {isComparisonView && <GenerationComparisonHeader />}
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
                                    <PlaygroundComparisonGenerationInputHeader className="!w-[400px] shrink-0 sticky left-0 top-0 z-[5]" />

                                    {displayedVariants.map((variantId) => (
                                        <GenerationComparisonOutputHeader
                                            key={variantId}
                                            variantId={variantId}
                                            className="!min-w-[400px] flex-1 shrink-0"
                                        />
                                    ))}
                                </div>
                            ) : null}

                            {/* ATOM-LEVEL OPTIMIZATION: Generation components using focused atom subscriptions
                            Comparison view: Uses rowIds from generationRowIdsAtom (chat/input rows)
                            Single view: Uses displayedVariants for individual variant generations */}
                            {shouldShowGenerationSkeleton ? (
                                <GenerationPanelSkeleton />
                            ) : isComparisonView ? (
                                <GenerationComparisonRenderer />
                            ) : (
                                (displayedVariants || []).map((variantId) => {
                                    // return null
                                    return (
                                        <PlaygroundGenerations
                                            key={variantId}
                                            variantId={variantId}
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
