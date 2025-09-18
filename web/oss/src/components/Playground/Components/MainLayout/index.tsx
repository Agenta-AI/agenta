"use client"
import React from "react"
import {memo, useCallback, useEffect, useRef, useState} from "react"

import {Typography, Button, Splitter} from "antd"
import clsx from "clsx"
import {useAtomValue, useSetAtom} from "jotai"
import useAnimationFrame from "use-animation-frame"

import LastTurnFooterControls from "@/oss/components/Playground/Components/ChatCommon/LastTurnFooterControls"
import {
    generationInputRowIdsAtom,
    generationRowIdsAtom,
} from "@/oss/components/Playground/state/atoms/generationProperties"
// import {inputRowsByIdAtom} from "@/oss/state/generation/entities"
// import {allInputRowIdsAtom} from "@/oss/state/generation/selectors"
import {chatTurnIdsAtom, inputRowIdsAtom} from "@/oss/state/generation/entities"
import {addChatTurnAtom} from "@/oss/state/newPlayground/chat/actions"
import {runChatTurnAtom, cancelChatTurnAtom} from "@/oss/state/newPlayground/chat/actions"
import {appStatusAtom} from "@/oss/state/variant/atoms/appStatus"
import {appStatusLoadingAtom} from "@/oss/state/variant/atoms/fetcher"

import {displayedVariantsAtom, isComparisonViewAtom, appChatModeAtom} from "../../state/atoms"
// No implicit input row seeding in this view
// import {addVariablesInputRowMutationAtom} from "../../state/atoms/generationMutations"
// import {displayedVariantsVariablesAtom} from "../../state/atoms/variants"
import {GenerationComparisonOutput} from "../PlaygroundGenerationComparisonView"
import PlaygroundComparisonGenerationInputHeader from "../PlaygroundGenerationComparisonView/assets/GenerationComparisonInputHeader/index."
import GenerationComparisonOutputHeader from "../PlaygroundGenerationComparisonView/assets/GenerationComparisonOutputHeader"
import GenerationComparisonHeader from "../PlaygroundGenerationComparisonView/GenerationComparisonHeader"
import PlaygroundGenerations from "../PlaygroundGenerations"
import PromptComparisonVariantNavigation from "../PlaygroundPromptComparisonView/PromptComparisonVariantNavigation"
import PlaygroundVariantConfig from "../PlaygroundVariantConfig"
import type {BaseContainerProps} from "../types"

interface MainLayoutProps extends BaseContainerProps {
    isLoading?: boolean
}

const SplitterPanel = Splitter.Panel

const GenerationComparisonRenderer = memo(() => {
    // Variables rows (inputs) and logical chat turn ids
    const rowIds = useAtomValue(generationInputRowIdsAtom)
    const turnIds = useAtomValue(chatTurnIdsAtom)
    const isChat = useAtomValue(appChatModeAtom)

    if (isChat === undefined) return null

    const sourceIds = isChat ? turnIds : rowIds

    const list = (sourceIds || []).map((rowId, rowIndex) => (
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

    return <>{list}</>
})

const PlaygroundMainView = ({className, isLoading = false, ...divProps}: MainLayoutProps) => {
    const isComparisonView = useAtomValue(isComparisonViewAtom)
    const displayedVariants = useAtomValue(displayedVariantsAtom)

    const appStatus = useAtomValue(appStatusAtom)
    const appStatusLoading = useAtomValue(appStatusLoadingAtom)

    // OPTIMIZED LOADING: displayedVariants are just IDs, so we can render components immediately
    // Let PlaygroundVariantConfig handle its own loading state internally
    const hasDisplayedVariantIds = displayedVariants && displayedVariants.length > 0

    // Only show skeleton when we don't have variant IDs yet (very early loading)
    // Once we have IDs, render the components and let them handle their own loading
    const shouldShowVariantConfigSkeleton =
        appStatusLoading || (isLoading && !hasDisplayedVariantIds)
    const shouldShowGenerationSkeleton = appStatusLoading || (isLoading && !hasDisplayedVariantIds)
    const notReachable = !appStatusLoading && !appStatus
    const variantRefs = useRef<(HTMLDivElement | null)[]>([])

    const handleScroll = useCallback(
        (index: number) => {
            const targetRef = variantRefs.current[index]

            if (targetRef) {
                targetRef.scrollIntoView({behavior: "smooth", inline: "end"})
            }
        },
        [variantRefs],
    )

    /**
     * Scroll Sync Login
     * to be extracted to a custom hook once it is refined and tested
     */

    const [configPanelRef, setConfigPanelRef] = useState<HTMLElement | null>(null)
    const [generationPanelRef, _setGenerationPanelRef] = useState<HTMLDivElement | null>(null)
    const scrollingRef = useRef<{
        scrolling: HTMLElement
        target: HTMLElement
    } | null>(null)

    useAnimationFrame(({time}) => {
        const isScrolling = scrollingRef.current

        if (!isScrolling || !configPanelRef) return

        const {scrolling, target} = isScrolling

        if (scrolling && target) {
            target.scrollLeft = scrolling.scrollLeft
        }
    })

    useEffect(() => {
        const configPanel = configPanelRef

        const scrollHandle = (e: Event) => {
            if (scrollingRef.current) return
            if (!isComparisonView) return

            const elm = e.target as HTMLElement
            const scrolling = elm.isSameNode(configPanel) ? configPanel : generationPanelRef

            if (!scrolling) {
                return
            }

            const target = scrolling!.isSameNode(configPanel) ? generationPanelRef : configPanel

            if (!target) {
                return
            }

            scrollingRef.current = {
                scrolling,
                target,
            }
        }
        const scrollEndHandle = () => {
            scrollingRef.current = null
        }

        if (configPanel) {
            configPanel.addEventListener("scroll", scrollHandle)
            configPanel.addEventListener("scrollend", scrollEndHandle)
        }

        if (generationPanelRef) {
            generationPanelRef.addEventListener("scroll", scrollHandle)
            generationPanelRef.addEventListener("scrollend", scrollEndHandle)
        }

        return () => {
            if (configPanel) {
                configPanel.removeEventListener("scroll", scrollHandle)
                configPanel.removeEventListener("scroll", scrollEndHandle)
            }

            if (generationPanelRef) {
                generationPanelRef.removeEventListener("scroll", scrollHandle)
                generationPanelRef.removeEventListener("scroll", scrollEndHandle)
            }
        }
    }, [isComparisonView, configPanelRef, generationPanelRef])

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
                    className="h-full"
                    layout={isComparisonView ? "vertical" : "horizontal"}
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
                                    // SKELETON: Show loading placeholder for variant navigation
                                    <div className="[&::-webkit-scrollbar]:w-0 w-[400px] sticky left-0 z-10 h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)] bg-white">
                                        <div className="p-4 space-y-4">
                                            <div className="h-6 bg-gray-200 rounded mb-4" />
                                            {[1, 2, 3].map((index) => (
                                                <div
                                                    key={`nav-skeleton-${index}`}
                                                    className="space-y-3 p-3 border border-gray-100 rounded"
                                                >
                                                    <div className="h-5 bg-gray-200 rounded " />
                                                    <div className="h-4 bg-gray-200 rounded w-3/4" />
                                                    <div className="h-3 bg-gray-200 rounded w-1/2" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ) : (
                                    <PromptComparisonVariantNavigation
                                        className="[&::-webkit-scrollbar]:w-0 w-[400px] sticky left-0 z-10 h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)] bg-white"
                                        handleScroll={handleScroll}
                                    />
                                ))}
                            {shouldShowVariantConfigSkeleton
                                ? // SKELETON: Show loading placeholders for variant configs
                                  [1, 2].map((index) => (
                                      <div
                                          key={`skeleton-${index}`}
                                          className={clsx([
                                              {
                                                  "[&::-webkit-scrollbar]:w-0 min-w-[400px] flex-1 h-full max-h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)] relative":
                                                      isComparisonView,
                                              },
                                          ])}
                                      >
                                          <div className="p-4 space-y-4">
                                              <div className="h-8 bg-gray-200 rounded" />
                                              <div className="space-y-2">
                                                  <div className="h-4 bg-gray-200 rounded " />
                                                  <div className="h-4 bg-gray-200 rounded  w-3/4" />
                                                  <div className="h-4 bg-gray-200 rounded  w-1/2" />
                                              </div>
                                              <div className="h-32 bg-gray-200 rounded" />
                                          </div>
                                      </div>
                                  ))
                                : (displayedVariants || []).map((variant, index) => {
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
                                  })}
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
                            ref={_setGenerationPanelRef}
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
                                // SKELETON: Show loading placeholders for generation panel
                                <div className="p-4 space-y-4">
                                    <div className="h-6 bg-gray-200 rounded w-1/4" />
                                    <div className="space-y-3">
                                        <div className="h-4 bg-gray-200 rounded" />
                                        <div className="h-4 bg-gray-200 rounded w-5/6" />
                                        <div className="h-4 bg-gray-200 rounded w-3/4" />
                                    </div>
                                    <div className="h-24 bg-gray-200 rounded" />
                                    <div className="flex gap-2">
                                        <div className="h-8 w-16 bg-gray-200 rounded" />
                                        <div className="h-8 w-20 bg-gray-200 rounded" />
                                    </div>
                                </div>
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
            </div>
        </main>
    )
}

// PERFORMANCE OPTIMIZATION: Memo with custom comparison
// Only re-render if props actually change (className, isLoading, etc.)
export default memo(PlaygroundMainView, (prevProps, nextProps) => {
    return (
        prevProps.className === nextProps.className && prevProps.isLoading === nextProps.isLoading
        // Add other prop comparisons if needed
    )
})
