import dynamic from "next/dynamic"
import clsx from "clsx"

import usePlayground from "../../hooks/usePlayground"
import type {BaseContainerProps} from "../types"
import {Button, Typography} from "antd"
import {Play} from "@phosphor-icons/react"
import GenerationComparisionCompletionOuput from "../PlaygroundGenerationComparisionView/GenerationComparisionCompletionOuput"
import GenerationComparisionCompletionInput from "../PlaygroundGenerationComparisionView/GenerationComparisionCompletionInput"
import PromptComparisionVariantNavigation from "../PlaygroundPromptComparisionView/PromptComparisionVariantNavigation"

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
        <div className={clsx("flex flex-col grow h-full overflow-hidden", className)} {...divProps}>
            <div className="w-full max-h-full h-full grow relative overflow-hidden">
                <Splitter className="h-full" layout={isComparisonView ? "vertical" : "horizontal"}>
                    <SplitterPanel defaultSize="40%" min="20%" max="70%" className="!h-full">
                        <div
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
                        </div>
                    </SplitterPanel>
                    <SplitterPanel className="!h-full">
                        {isComparisonView && (
                            <div className="flex items-center justify-between gap-2 px-4 py-2 bg-[#F5F7FA]">
                                <Typography className="text-[16px] leading-[18px] font-[600]">
                                    Generations
                                </Typography>

                                <div className="flex items-center gap-2">
                                    <Button size="small">Clear</Button>

                                    <Button type="primary" icon={<Play size={14} />} size="small">
                                        Run
                                    </Button>
                                </div>
                            </div>
                        )}
                        <div
                            className={clsx([
                                {
                                    "grow w-full h-full overflow-y-auto": viewType === "single",
                                    "grow w-full h-full overflow-x-auto flex": isComparisonView,
                                },
                            ])}
                        >
                            {isComparisonView && (
                                <>
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
                                                <GenerationComparisionCompletionInput
                                                    variantId={variantId}
                                                    className="w-[400px] h-full overflow-y-auto *:!overflow-x-hidden"
                                                />
                                            </div>
                                        )
                                    })}
                                </>
                            )}

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
                        </div>
                    </SplitterPanel>
                </Splitter>
            </div>
        </div>
    )
}

export default PlaygroundMainView
