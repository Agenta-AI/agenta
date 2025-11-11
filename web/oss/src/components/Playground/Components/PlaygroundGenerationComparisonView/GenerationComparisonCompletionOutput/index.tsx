import {useCallback, useMemo} from "react"

import clsx from "clsx"
import JSON5 from "json5"
import dynamic from "next/dynamic"

import usePlayground from "@/oss/components/Playground/hooks/usePlayground"
import {PlaygroundStateData} from "@/oss/components/Playground/hooks/usePlayground/types"
import TooltipWithCopyAction from "@/oss/components/TooltipWithCopyAction"
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

    const responseData = result?.response?.data
    const value =
        typeof responseData === "string"
            ? responseData
            : typeof responseData === "object" && responseData.hasOwnProperty("content")
              ? responseData.content
              : ""

    let isJSON = false
    try {
        JSON.parse(value)
        isJSON = true
    } catch (e) {
        isJSON = false
    }

    return (
        <>
            {variantIndex === 0 ? (
                <div
                    className={clsx([
                        "border-0 border-b border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[3] !w-[400px]",
                        {"border-r": variantIndex === 0},
                        "shrink-0",
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
                                    className={clsx(["!pt-0", "!rounded-none"])}
                                    error={!!result.error}
                                    editorClassName="min-h-4 [&_p:first-child]:!mt-0 py-3"
                                    footer={
                                        <GenerationResultUtils className="mt-2" result={result} />
                                    }
                                />
                            ) : result.response ? (
                                Array.isArray(result.response?.data) ? (
                                    result.response.data.map((message, index) => {
                                        let _json = false
                                        try {
                                            const parsed = JSON5.parse(message.content)
                                            parsed.function.arguments = JSON5.parse(
                                                parsed.function.arguments,
                                            )
                                            const displayValue = {
                                                arguments: parsed.function.arguments,
                                            }
                                            _json = true

                                            return (
                                                <SharedEditor
                                                    key={message.id}
                                                    initialValue={displayValue}
                                                    editorType="border"
                                                    // state="filled"
                                                    readOnly
                                                    editorProps={{
                                                        codeOnly: _json,
                                                    }}
                                                    header={
                                                        <div className="py-1 flex items-center justify-between w-full">
                                                            <TooltipWithCopyAction
                                                                title={"Function name"}
                                                            >
                                                                <span>{parsed.function.name}</span>
                                                            </TooltipWithCopyAction>
                                                            <TooltipWithCopyAction
                                                                title={"Call id"}
                                                            >
                                                                <span>{parsed.id}</span>
                                                            </TooltipWithCopyAction>
                                                        </div>
                                                    }
                                                    disabled
                                                    editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                                    footer={
                                                        <GenerationResultUtils
                                                            className="mt-2"
                                                            result={result}
                                                        />
                                                    }
                                                    className="mt-2 [&:first-child]:!mt-0"
                                                    handleChange={handleChange}
                                                />
                                            )
                                        } catch (e) {
                                            console.log("RENDER MSG ITEM ERROR!", message, e)
                                            return <div>errored</div>
                                        }
                                    })
                                ) : (
                                    <SharedEditor
                                        initialValue={value}
                                        handleChange={handleChange}
                                        editorType="borderless"
                                        state="filled"
                                        readOnly
                                        test
                                        editorProps={{
                                            codeOnly: isJSON,
                                        }}
                                        disabled
                                        className="!rounded-none !px-4"
                                        editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                        footer={
                                            <GenerationResultUtils
                                                className="mt-2"
                                                result={result}
                                            />
                                        }
                                    />
                                )
                            ) : null}
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}

export default GenerationComparisonCompletionOutput
