import {useCallback, useMemo} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import {GenerationComparisonCompletionOutputProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {findPropertyInObject} from "@/lib/hooks/useStatelessVariant/assets/helpers"
import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
import SharedEditor from "../../SharedEditor"
import {getResponseLazy} from "@/components/NewPlayground/state"
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
    registerToWebWorker,
}: GenerationComparisonCompletionOutputProps) => {
    const {resultHash, isRunning} = usePlayground({
        registerToWebWorker: registerToWebWorker ?? true,
        variantId,
        rowId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRow = findPropertyInObject(state, rowId)
                const variantRun = inputRow?.__runs?.[variantId]
                return {
                    resultHash: variantRun?.__result,
                    isRunning: variantRun?.__isRunning,
                }
            },
            [rowId, variantId],
        ),
    })

    const result = useMemo(() => {
        return getResponseLazy(resultHash)
    }, [resultHash])

    return (
        <>
            {variantIndex === 0 ? (
                <div
                    className={clsx([
                        "border-0 border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[3] !w-[400px]",
                        {"border-r": variantIndex === 0},
                        {"border-b": !isLastRow},
                    ])}
                >
                    {variantIndex === 0 && (
                        <div className="w-full flex-1 shrink-0 sticky top-9 z-[2] border-0">
                            <GenerationCompletion rowId={rowId} withControls={isLastRow} />
                        </div>
                    )}
                </div>
            ) : null}

            <div
                className={clsx([
                    "!min-w-[400px] flex-1",
                    "border-0 border-r border-solid border-[rgba(5,23,41,0.06)]",
                    {"border-b": !isLastRow},
                ])}
            >
                <div className="flex h-full">
                    <div className="w-full flex-1 h-full">
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
