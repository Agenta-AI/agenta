import dynamic from "next/dynamic"
import clsx from "clsx"

import usePlayground from "../../hooks/usePlayground"
import type {BaseContainerProps} from "../types"
import GenerationComparisionCompletionOuput from "../PlaygroundGenerationComparisionView/GenerationComparisionCompletionOuput"
import GenerationComparisionCompletionInput from "../PlaygroundGenerationComparisionView/GenerationComparisionCompletionInput"
import GenerationComparisonHeader from "../PlaygroundGenerationComparisionView/GenerationComparisonHeader"

const PromptComparisionVariantNavigation = dynamic(
    () => import("../PlaygroundPromptComparisionView/PromptComparisionVariantNavigation"),
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
                    <SplitterPanel defaultSize="40%" min="20%" max="70%" className="!h-full">
                        <section
                            className={clsx([
                                {
                                    "grow w-full h-full overflow-y-auto": viewType === "single",
                                    "grow w-full h-full overflow-x-auto flex": isComparisonView,
                                },
                            ])}
                        >
                            {isComparisonView && <PromptComparisionVariantNavigation />}
                            {(displayedVariants || []).map((variantId) => {
                                return (
                                    <div
                                        key={variantId}
                                        className={clsx([
                                            {
                                                "[&::-webkit-scrollbar]:w-0 w-[400px] h-full overflow-y-auto":
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
                        className={clsx("!h-full", {"overflow-y-hidden": isComparisonView})}
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
                                            className="[&::-webkit-scrollbar]:w-0 w-[400px] h-full overflow-y-auto"
                                        >
                                            <GenerationComparisionCompletionInput rowClassName="bg-[#f5f7fa]" />
                                        </div>
                                    )
                                })}

                            {(displayedVariants || []).map((variantId) => {
                                return (
                                    <div
                                        key={variantId}
                                        className={clsx([
                                            {
                                                "[&::-webkit-scrollbar]:w-0 w-[400px] h-full overflow-y-auto":
                                                    isComparisonView,
                                            },
                                        ])}
                                    >
                                        {isComparisonView ? (
                                            <GenerationComparisionCompletionOuput
                                                variantId={variantId}
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
