import dynamic from "next/dynamic"
import clsx from "clsx"

import usePlayground from "../../hooks/usePlayground"
import type {BaseContainerProps} from "../types"
import GenerationComparisonCompletionOutput from "../PlaygroundGenerationComparisonView/GenerationComparisonCompletionOutput"
import GenerationComparisonCompletionInput from "../PlaygroundGenerationComparisonView/GenerationComparisonCompletionInput"
import GenerationComparisonHeader from "../PlaygroundGenerationComparisonView/GenerationComparisonHeader"

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
                            className={clsx([
                                {
                                    "grow w-full h-full overflow-y-auto": viewType === "single",
                                    "grow w-full h-full overflow-x-auto flex [&::-webkit-scrollbar]:w-0":
                                        isComparisonView,
                                },
                            ])}
                        >
                            {isComparisonView && (
                                <PromptComparisonVariantNavigation className="[&::-webkit-scrollbar]:w-0 w-[400px] h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)]" />
                            )}
                            {(displayedVariants || []).map((variantId) => {
                                return (
                                    <div
                                        key={variantId}
                                        className={clsx([
                                            {
                                                "[&::-webkit-scrollbar]:w-0 w-[400px] h-full overflow-y-auto flex-shrink-0 border-0 border-r border-solid border-[rgba(5,23,41,0.06)]":
                                                    isComparisonView,
                                            },
                                        ])}
                                    >
                                        <PlaygroundVariantConfig variantId={variantId} />
                                    </div>
                                )
                            })}
                        </section>
                    </SplitterPanel>

                    <SplitterPanel
                        className={clsx("!h-full", {"!overflow-y-hidden": isComparisonView})}
                        collapsible
                        defaultSize={isComparisonView ? "60%" : "70"}
                    >
                        {isComparisonView && <GenerationComparisonHeader />}

                        <section
                            className={clsx([
                                {
                                    "grow w-full h-full overflow-y-auto": viewType === "single",
                                    "grow w-full h-full overflow-x-auto flex": isComparisonView,
                                },
                            ])}
                        >
                            {isComparisonView &&
                                (displayedVariants?.slice(0, 1) || []).map((variantId) => {
                                    return (
                                        <div
                                            key={variantId}
                                            className="[&::-webkit-scrollbar]:w-0 w-[400px] h-full overflow-y-auto flex-shrink-0"
                                        >
                                            <GenerationComparisonCompletionInput
                                                variantId={variantId}
                                                rowClassName="bg-[#f5f7fa] border-0 border-r border-solid border-[rgba(5,23,41,0.06)]"
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
                                                "[&::-webkit-scrollbar]:w-0 w-[400px] h-full overflow-y-auto flex-shrink-0":
                                                    isComparisonView,
                                            },
                                        ])}
                                    >
                                        {isComparisonView ? (
                                            <GenerationComparisonCompletionOutput
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
