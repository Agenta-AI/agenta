import {useCallback, useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import RunButton from "@/oss/components/NewPlayground/assets/RunButton"
import {PlaygroundStateData} from "@/oss/components/NewPlayground/hooks/usePlayground/types"
import {getResponseLazy} from "@/oss/components/NewPlayground/state"

import {getEnhancedProperties} from "../../../../assets/utilities/genericTransformer/utilities/enhanced"
import usePlayground from "../../../../hooks/usePlayground"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"
import SharedEditor from "../../../SharedEditor"
import GenerationOutputText from "../GenerationOutputText"

import {useStyles} from "./styles"
import type {GenerationCompletionRowProps} from "./types"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {autoScrollToBottom} from "@/oss/components/NewPlayground/assets/utilities/utilityFunctions"

const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {
    ssr: false,
})
const GenerationVariableOptions = dynamic(() => import("../GenerationVariableOptions"), {
    ssr: false,
})

const handleChange = () => undefined

const GenerationCompletionRow = ({
    variantId,
    rowId,
    className,
    inputOnly,
    view,
    disabled,
    ...props
}: GenerationCompletionRowProps) => {
    const classes = useStyles()
    const {resultHash, variableIds, runTests, isRunning, viewType, isChat} = usePlayground({
        variantId,
        rowId,
        registerToWebWorker: true,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRow = state.generationData.inputs.value.find((inputRow) => {
                    return inputRow.__id === rowId
                })

                const variables = getEnhancedProperties(inputRow)
                const variableIds = variables.map((p) => p.__id)

                const resultHash = variantId ? inputRow?.__runs?.[variantId]?.__result : null
                const isRunning = variantId ? inputRow?.__runs?.[variantId]?.__isRunning : false

                return {
                    isChat: state.variants[0]?.isChat,
                    variableIds,
                    resultHash,
                    isRunning,
                    inputText: variables?.[0]?.value, // Temporary implementation
                }
            },
            [rowId, variantId],
        ),
    })

    useLazyEffect(() => {
        const timer = autoScrollToBottom()
        return timer
    }, [resultHash])

    const result = useMemo(() => {
        return getResponseLazy(resultHash)
    }, [resultHash])

    const runRow = useCallback(async () => {
        runTests?.(rowId, viewType === "single" ? variantId : undefined)
    }, [runTests, variantId, rowId, viewType])

    if (viewType === "single" && view !== "focus" && variantId) {
        const responseData = result?.response?.data
        return (
            <div
                className={clsx([
                    "flex flex-col",
                    "p-4",
                    "group/item",
                    {"gap-4": variableIds.length > 0},
                    classes.container,
                ])}
                {...props}
            >
                <div
                    className={clsx("flex gap-1 items-start", {
                        "flex flex-col gap-4 w-full": isChat,
                    })}
                >
                    {variableIds.length > 0 && (
                        <>
                            <div className="w-[100px] shrink-0">
                                <Typography className="font-[500] text-[12px] leading-[20px]">
                                    Variables
                                </Typography>
                            </div>
                            <div className="flex flex-col grow gap-2 w-full">
                                {variableIds.map((variableId) => {
                                    return (
                                        <PlaygroundVariantPropertyControl
                                            key={variableId}
                                            variantId={variantId}
                                            propertyId={variableId}
                                            rowId={rowId}
                                            placeholder="Enter value"
                                        />
                                    )
                                })}
                            </div>

                            {!inputOnly && (
                                <GenerationVariableOptions
                                    variantId={variantId}
                                    rowId={rowId}
                                    className="invisible group-hover/item:visible"
                                    resultHash={resultHash}
                                />
                            )}
                        </>
                    )}
                </div>

                {!inputOnly && (
                    <div className="w-full flex gap-1 items-start">
                        <div className="w-[100px] shrink-0">
                            <RunButton onClick={runRow} disabled={isRunning} />
                        </div>
                        <div className="w-full flex flex-col gap-4">
                            {isRunning ? (
                                <GenerationOutputText text="Running..." />
                            ) : !result ? (
                                <GenerationOutputText text="Click run to generate output" />
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
                                    handleChange={handleChange}
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
                                    editorType="borderless"
                                    state="filled"
                                    readOnly
                                    disabled
                                    className="!p-0"
                                    editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                    footer={
                                        <GenerationResultUtils className="mt-2" result={result} />
                                    }
                                    handleChange={handleChange}
                                />
                            ) : null}
                        </div>

                        {/**This is used in when we don't have variables to display */}
                        {variableIds.length === 0 ? (
                            <GenerationVariableOptions
                                variantId={variantId}
                                rowId={rowId}
                                className="invisible group-hover/item:visible"
                                resultHash={resultHash}
                            />
                        ) : (
                            <div className="flex items-center w-[50px] shrink-0" />
                        )}
                    </div>
                )}
            </div>
        )
    }

    return (
        <>
            <div className={clsx(["flex flex-col gap-4"])} {...props}>
                <div className="flex gap-1 items-start">
                    <div className="flex flex-col grow">
                        {variableIds.map((variableId) => {
                            return (
                                <div key={variableId} className="relative group/item px-3 py-2">
                                    <PlaygroundVariantPropertyControl
                                        variantId={variantId}
                                        propertyId={variableId}
                                        view={view}
                                        rowId={rowId}
                                        className="*:!border-none"
                                        disabled={disabled}
                                        placeholder="Enter value"
                                    />

                                    {!inputOnly && (
                                        <GenerationVariableOptions
                                            variantId={variantId as string}
                                            rowId={rowId}
                                            className="invisible group-hover/item:visible absolute top-5 right-5"
                                            resultHash={resultHash}
                                            variableId={variableId}
                                        />
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>

            {!inputOnly ? (
                <div className={clsx("h-[48px] flex items-center px-4")}>
                    <RunButton onClick={runRow} disabled={isRunning} className="flex" />
                </div>
            ) : null}
        </>
    )
}

export default GenerationCompletionRow
