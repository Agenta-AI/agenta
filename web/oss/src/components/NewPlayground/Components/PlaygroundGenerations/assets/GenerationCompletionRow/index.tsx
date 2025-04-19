import {useCallback, useMemo} from "react"

import {Typography} from "antd"
import clsx from "clsx"
import dynamic from "next/dynamic"

import RunButton from "@/oss/components/NewPlayground/assets/RunButton"
import {autoScrollToBottom} from "@/oss/components/NewPlayground/assets/utilities/utilityFunctions"
import {PlaygroundStateData} from "@/oss/components/NewPlayground/hooks/usePlayground/types"
import useLazyEffect from "@/oss/hooks/useLazyEffect"
import {getResponseLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {getEnhancedProperties} from "@/oss/lib/shared/variant"

import usePlayground from "../../../../hooks/usePlayground"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"
import SharedEditor from "../../../SharedEditor"
import GenerationOutputText from "../GenerationOutputText"

import {useStyles} from "./styles"
import type {GenerationCompletionRowProps} from "./types"

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
    const {resultHash, variableIds, runTests, isRunning, viewType, isChat, cancelRunTests} =
        usePlayground({
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

                    const variant = state.variants.find((v) => v.id === variantId)
                    const isJSONMode = variant?.prompts?.some((p) =>
                        p.llmConfig?.responseFormat?.value?.type?.includes?.("json"),
                    )
                    return {
                        isChat: state.variants[0]?.isChat,
                        variableIds,
                        resultHash,
                        isRunning,
                        inputText: variables?.[0]?.value, // Temporary implementation
                        isJSONMode,
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

    const cancelRow = useCallback(async () => {
        cancelRunTests?.(rowId, viewType === "single" ? variantId : undefined)
    }, [cancelRunTests, variantId, rowId, viewType])

    if (viewType === "single" && view !== "focus" && variantId) {
        const responseData = result?.response?.data
        let value =
            typeof responseData === "string"
                ? responseData
                : typeof responseData === "object" && responseData.hasOwnProperty("content")
                  ? responseData.content
                  : ""

        let isJSON = false
        try {
            const parsed = JSON.parse(value)
            isJSON = true
            value = JSON.stringify(parsed, null, 2)
        } catch (e) {
            isJSON = false
        }

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
                    <div className="w-full flex gap-1 items-start z-[1]">
                        <div className="w-[100px] shrink-0">
                            {!isRunning ? (
                                <RunButton onClick={runRow} disabled={!!isRunning} />
                            ) : (
                                <RunButton isCancel onClick={cancelRow} />
                            )}
                        </div>
                        <div
                            className={clsx([
                                "w-full flex flex-col gap-4",
                                {"max-w-[calc(100%-158px)]": viewType !== "comparison"},
                                {"max-w-[100%]": viewType === "comparison"},
                            ])}
                        >
                            {isRunning ? (
                                <GenerationOutputText text="Running..." />
                            ) : !result ? (
                                <GenerationOutputText
                                    text="Click run to generate output"
                                    isPlaceholder
                                />
                            ) : result.error ? (
                                <SharedEditor
                                    initialValue={result?.error}
                                    editorType="borderless"
                                    state="filled"
                                    readOnly
                                    disabled
                                    error
                                    className={clsx([
                                        {
                                            "": result?.error,
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
                                        isJSON && typeof value === "string"
                                            ? JSON.parse(value)
                                            : value
                                    }
                                    editorType="borderless"
                                    state="filled"
                                    readOnly
                                    editorProps={{
                                        codeOnly: isJSON,
                                    }}
                                    disabled
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
                            <div className="flex items-center w-[50px] shrink-0 grow-1 self-stretch" />
                        )}
                    </div>
                )}
            </div>
        )
    }

    return (
        <>
            <div
                className={clsx([
                    "flex flex-col gap-4",
                    {"max-w-[calc(100%-158px)]": viewType !== "comparison"},
                    {"max-w-[100%]": viewType === "comparison"},
                ])}
                {...props}
            >
                <div className="flex gap-1 items-start">
                    <div className="flex flex-col grow">
                        {variableIds.map((variableId) => {
                            return (
                                <div
                                    key={variableId}
                                    className={clsx([
                                        "relative group/item px-3 py-2",
                                        {
                                            "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]":
                                                isChat && viewType === "comparison",
                                            "!px-0 !py-0": viewType === "comparison",
                                        },
                                    ])}
                                >
                                    <PlaygroundVariantPropertyControl
                                        variantId={variantId}
                                        propertyId={variableId}
                                        view={view}
                                        rowId={rowId}
                                        className={clsx([
                                            "*:!border-none",
                                            {
                                                "rounded-none [&_article]:px-3 [&_article]:py-1 px-3":
                                                    viewType === "comparison",
                                            },
                                        ])}
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
                    {!isRunning ? (
                        <RunButton onClick={runRow} disabled={!!isRunning} className="flex" />
                    ) : (
                        <RunButton isCancel onClick={cancelRow} className="flex" />
                    )}
                </div>
            ) : null}
        </>
    )
}

export default GenerationCompletionRow
