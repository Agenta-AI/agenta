import {useCallback} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import {GenerationComparisonCompletionOutputProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {findPropertyInObject} from "@/lib/hooks/useStatelessVariant/assets/helpers"
import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
import SharedEditor from "../../SharedEditor"
const GenerationResultUtils = dynamic(
    () => import("../../PlaygroundGenerations/assets/GenerationResultUtils"),
    {ssr: false},
)

const GenerationComparisonCompletionOutput = ({
    rowId,
    focusDisable = false,
    variantId,
    variantIndex,
    isLastRow,
    isLastVariant,
}: GenerationComparisonCompletionOutputProps) => {
    const {result, isRunning} = usePlayground({
        registerToWebWorker: true,
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRow = findPropertyInObject(state, rowId)
                const variantRun = inputRow?.__runs?.[variantId]
                return {
                    result: variantRun?.__result,
                    isRunning: variantRun?.__isRunning,
                }
            },
            [rowId, variantId],
        ),
    })

    return (
        <>
            <div
                className={clsx([
                    "border-0 border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[3]",
                    {"border-r": variantIndex === 0},
                    {"border-b": !isLastRow},
                ])}
            >
                {variantIndex === 0 && (
                    <div className="!w-[399px] shrink-0 sticky top-9 z-[2] border-0">
                        <GenerationCompletion
                            variantId={variantId}
                            rowId={rowId}
                            withControls={isLastRow}
                        />
                    </div>
                )}
            </div>

            <div
                className={clsx([
                    "border-0 border-r border-solid border-[rgba(5,23,41,0.06)]",
                    {"border-b": !isLastRow},
                ])}
            >
                <div className="flex h-full">
                    <div className="!w-[399px] h-full">
                        <div className="w-full py-2 px-4 sticky top-9 z-[2]">
                            {isRunning ? (
                                <GenerationOutputText text="Running..." />
                            ) : !result ? (
                                <GenerationOutputText text="Click Run to generate" />
                            ) : result.error ? (
                                <SharedEditor
                                    initialValue={result?.error}
                                    editorType="borderless"
                                    state="filled"
                                    readOnly
                                    disabled
                                    className={clsx([
                                        "!pt-0",
                                        {
                                            "[&_.agenta-rich-text-editor_*]:!text-[red] [&_.message-user-select]:text-[red]":
                                                result?.error,
                                        },
                                    ])}
                                    editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                    footer={
                                        <GenerationResultUtils className="mt-2" result={result} />
                                    }
                                />
                            ) : result.response ? (
                                <SharedEditor
                                    initialValue={result?.response?.data}
                                    editorType="borderless"
                                    state="filled"
                                    readOnly
                                    disabled
                                    className="!p-0"
                                    editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                    footer={
                                        <GenerationResultUtils className="mt-2" result={result} />
                                    }
                                />
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

export default GenerationComparisonCompletionOutput
