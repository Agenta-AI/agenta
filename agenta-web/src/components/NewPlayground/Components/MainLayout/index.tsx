import {useEffect, useRef, useState} from "react"

import dynamic from "next/dynamic"
import clsx from "clsx"
import useAnimationFrame from "use-animation-frame"

import usePlayground from "../../hooks/usePlayground"
import GenerationComparisonHeader from "../PlaygroundGenerationComparisonView/GenerationComparisonHeader"
import {
    GenerationComparisonInputConfig,
    GenerationComparisonOutputConfig,
} from "../PlaygroundGenerationComparisonView"

import type {BaseContainerProps} from "../types"

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

const PlaygroundMainView = ({className, ...divProps}: BaseContainerProps) => {
    const {viewType, displayedVariants} = usePlayground()
    const isComparisonView = viewType === "comparison"
    const variantRefs = useRef<(HTMLDivElement | null)[]>([])

    const handleScroll = (index: number) => {
        const targetRef = variantRefs.current[index]

        if (targetRef) {
            targetRef.scrollIntoView({behavior: "smooth", inline: "end"})
        }
    }

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
            if (viewType === "single") return

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
    }, [viewType, configPanelRef, generationPanelRef])

    return (
        <main
            className={clsx("flex flex-col grow h-full overflow-hidden", className)}
            {...divProps}
        >
            <div className="w-full max-h-full h-full grow relative overflow-hidden">
                <Splitter className="h-full" layout={isComparisonView ? "vertical" : "horizontal"}>
                    <SplitterPanel
                        defaultSize={isComparisonView ? "40%" : "30"}
                        min="20%"
                        max="70%"
                        className="!h-full"
                        collapsible
                    >
                        <section
                            ref={setConfigPanelRef}
                            className={clsx([
                                {
                                    "grow w-full h-full overflow-y-auto": viewType === "single",
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
                                                "[&::-webkit-scrollbar]:w-0 w-[400px] h-full max-h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)] relative":
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
                            "!overflow-y-hidden": isComparisonView,
                        })}
                        collapsible
                        defaultSize={isComparisonView ? "60%" : "70"}
                    >
                        {isComparisonView && <GenerationComparisonHeader />}

                        <section
                            ref={setGenerationPanelRef}
                            className={clsx([
                                {
                                    "grow w-full h-full overflow-y-auto": viewType === "single",
                                    "grow w-full h-full overflow-auto flex [&::-webkit-scrollbar]:w-0":
                                        isComparisonView,
                                },
                            ])}
                        >
                            {isComparisonView &&
                                (displayedVariants?.slice(0, 1) || []).map((variantId) => {
                                    return (
                                        <div
                                            key={variantId}
                                            className="[&::-webkit-scrollbar]:w-0 w-[400px] h-full flex-shrink-0 sticky left-0 z-10"
                                        >
                                            <GenerationComparisonInputConfig
                                                variantId={variantId}
                                            />
                                        </div>
                                    )
                                })}

                            {(displayedVariants || []).map((variantId, index) => {
                                return (
                                    <div
                                        key={variantId}
                                        className={clsx([
                                            {
                                                "[&::-webkit-scrollbar]:w-0 w-[400px] h-full flex-shrink-0":
                                                    isComparisonView,
                                            },
                                        ])}
                                    >
                                        {isComparisonView ? (
                                            <GenerationComparisonOutputConfig
                                                variantId={variantId}
                                                indexName={String.fromCharCode(65 + index)}
                                            />
                                        ) : (
                                            <PlaygroundGenerations variantId={variantId} />
                                        )}
                                    </div>
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
