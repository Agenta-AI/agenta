import {useCallback, useEffect, useRef, useState} from "react"

import dynamic from "next/dynamic"
import clsx from "clsx"
import useAnimationFrame from "use-animation-frame"

import usePlayground from "../../hooks/usePlayground"
import GenerationComparisonHeader from "../PlaygroundGenerationComparisonView/GenerationComparisonHeader"
import {GenerationComparisonOutput} from "../PlaygroundGenerationComparisonView"

import type {BaseContainerProps} from "../types"
import GenerationComparisonOutputHeader from "../PlaygroundGenerationComparisonView/assets/GenerationComparisonOutputHeader"

const PromptComparisonVariantNavigation = dynamic(
    () => import("../PlaygroundPromptComparisonView/PromptComparisonVariantNavigation"),
    {ssr: false},
)
const PlaygroundVariantConfig = dynamic(() => import("../PlaygroundVariantConfig"), {ssr: false})
const PlaygroundGenerations = dynamic(() => import("../PlaygroundGenerations"), {
    ssr: false,
})
const Splitter = dynamic(() => import("antd").then((mod) => mod.Splitter), {ssr: false})
const SplitterPanel = dynamic(() => import("antd").then((mod) => mod.Splitter.Panel), {ssr: false})
import PlaygroundComparisonGenerationInputHeader from "../PlaygroundGenerationComparisonView/assets/GenerationComparisonInputHeader/index."

const PlaygroundMainView = ({className, ...divProps}: BaseContainerProps) => {
    const {
        rowIds,
        isComparisonView,
        visibleVariants: displayedVariants,
        isChat,
    } = usePlayground({
        stateSelector: (state) => {
            const isChat = state.variants[0].isChat
            const isComparisonView = state.selected.length > 1
            let rowIds = [] as string[]

            if (isChat) {
                const messageRows = state.generationData.messages.value || []
                rowIds = messageRows.map((message) => message.__id).filter(Boolean)
            } else {
                const inputs = state.generationData.inputs.value || []
                rowIds = inputs.map((input) => input.__id)
            }

            return {
                rowIds,
                isComparisonView,
                visibleVariants: state.selected,
                isChat: state.variants[0].isChat,
            }
        },
    })

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
    const [generationPanelRef, setGenerationPanelRef] = useState<HTMLElement | null>(null)
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

            if (!scrolling) return

            const target = scrolling!.isSameNode(configPanel) ? generationPanelRef : configPanel

            if (!target) return

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

    return (
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
                            {isComparisonView && (
                                <PromptComparisonVariantNavigation
                                    className="[&::-webkit-scrollbar]:w-0 w-[400px] sticky left-0 z-10 h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)] bg-white"
                                    handleScroll={handleScroll}
                                />
                            )}
                            {(displayedVariants || []).map((variantId, index) => {
                                return (
                                    <div
                                        key={variantId}
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
                            ref={setGenerationPanelRef}
                            className={clsx([
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

                            {/* This component renders Output components based on the view type. 
                                    If the view is 'comparison', it uses generationData to render the component. 
                                    In 'single' view, it uses the variant id to render the component. */}
                            {isComparisonView
                                ? ((rowIds as string[]) || []).map((rowId, rowIndex) => {
                                      return (
                                          <div key={rowId} className="min-w-fit">
                                              <GenerationComparisonOutput
                                                  rowId={rowId}
                                                  isLastRow={rowIndex === rowIds.length - 1}
                                              />
                                          </div>
                                      )
                                  })
                                : (displayedVariants || []).map((variantId) => {
                                      return (
                                          <PlaygroundGenerations
                                              key={variantId}
                                              variantId={variantId}
                                          />
                                      )
                                  })}
                        </section>
                    </SplitterPanel>
                </Splitter>
            </div>
        </main>
    )
}

export default PlaygroundMainView
