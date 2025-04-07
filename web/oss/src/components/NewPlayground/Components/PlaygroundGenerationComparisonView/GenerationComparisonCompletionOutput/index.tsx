import {useCallback, useMemo} from "react"

import clsx from "clsx"
import dynamic from "next/dynamic"

import usePlayground from "@/oss/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/oss/components/NewPlayground/hooks/usePlayground/types"
import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"

import {findPropertyInObject} from "../../../hooks/usePlayground/assets/helpers"
import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import SharedEditor from "../../SharedEditor"

import {GenerationComparisonCompletionOutputProps} from "./types"
const GenerationResultUtils = dynamic(
    () => import("../../PlaygroundGenerations/assets/GenerationResultUtils"),
    {ssr: false},
)

const handleChange = () => undefined

const GenerationComparisonCompletionOutput = ({
    rowId,
    focusDisable = false,
    variantId,
    variantIndex,
    isLastRow,
    registerToWebWorker,
}: GenerationComparisonCompletionOutputProps) => {
    const {resultHash, isRunning, viewType} = usePlayground({
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

    const responseData = result?.response?.data

    return (
        <>
            {variantIndex === 0 ? (
                <div
                    className={clsx([
                        "border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[3] !w-[400px]",
                        {"border-r": variantIndex === 0},
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
                    "border-0 border-r border-b border-solid border-[rgba(5,23,41,0.06)]",
                ])}
            >
                <div className="flex h-full">
                    <div className="w-full flex-1 h-full">
                        <div
                            className={clsx([
                                "w-full sticky top-9 z-[2]",
                                {"py-3 px-4": isRunning || !result},
                            ])}
                        >
                            {isRunning ? (
                                <GenerationOutputText text="Running..." />
                            ) : !result ? (
                                <GenerationOutputText text="Click run to generate" isPlaceholder />
                            ) : result.error ? (
                                <SharedEditor
                                    initialValue={result?.error}
                                    editorType="borderless"
                                    handleChange={handleChange}
                                    state="filled"
                                    readOnly
                                    disabled
                                    className={clsx([
                                        "!pt-0",
                                        "!rounded-none",
                                        {
                                            "[&_.agenta-rich-text-editor_*]:!text-[red] [&_.message-user-select]:text-[red]":
                                                result?.error,
                                        },
                                    ])}
                                    editorClassName="min-h-4 [&_p:first-child]:!mt-0 py-3"
                                    footer={
                                        <GenerationResultUtils className="mt-2" result={result} />
                                    }
                                />
                            ) : result.response ? (
                                <SharedEditor
                                    initialValue={
                                        typeof responseData === "string"
                                            ? responseData
                                            : typeof responseData === "object" &&
                                                responseData.hasOwnProperty("content")
                                              ? responseData.content
                                              : ""
                                    }
                                    handleChange={handleChange}
                                    editorType="borderless"
                                    state="filled"
                                    readOnly
                                    disabled
                                    className="!rounded-none !px-4"
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
