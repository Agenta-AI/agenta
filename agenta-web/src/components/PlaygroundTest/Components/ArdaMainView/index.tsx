import dynamic from "next/dynamic"
import clsx from "clsx"
import usePlayground from "../../hooks/usePlayground"
import PlaygroundVariantConfig from "../PlaygroundVariantConfig"
import PlaygroundVariantTestView from "../PlaygroundVariantTestView"
import { BaseContainerProps } from "../types"

const Splitter = dynamic(() => import("antd").then((mod) => mod.Splitter), {ssr: false})
const SplitterPanel = dynamic(() => import("antd").then((mod) => mod.Splitter.Panel), {ssr: false})

const PlaygroundMainView = ({className, ...divProps}: BaseContainerProps) => {
    const {viewType, displayedVariants} = usePlayground()
    return (
        <div className={clsx("flex flex-col grow h-full overflow-hidden", className)} {...divProps}>
            <div className="w-full max-h-full h-full grow relative overflow-hidden">
                <Splitter
                    className="h-full"
                    layout={viewType === "comparison" ? "vertical" : "horizontal"}
                >
                    <SplitterPanel defaultSize="40%" min="20%" max="70%" className="!h-full">
                        <div
                            className={clsx([
                                {
                                    "grow w-full h-full overflow-y-auto": viewType === "single",
                                    "grow w-full h-full overflow-x-auto flex":
                                        viewType === "comparison",
                                },
                            ])}
                        >
                            {(displayedVariants || []).map((variantId) => {
                                return (
                                    <div
                                        key={variantId}
                                        className={clsx([
                                            {
                                                "grow max-w-[700px]": viewType === "comparison",
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
                        <div
                            className={clsx([
                                {
                                    "grow w-full h-full overflow-y-auto": viewType === "single",
                                    "grow w-full h-full overflow-x-auto flex":
                                        viewType === "comparison",
                                },
                            ])}
                        >
                            {(displayedVariants || []).map((variantId) => {
                                return (
                                    <div
                                        key={variantId}
                                        className={clsx([
                                            {
                                                "grow max-w-[700px]": viewType === "comparison",
                                            },
                                        ])}
                                    >
                                        <PlaygroundVariantTestView variantId={variantId} />
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
