import {useCallback, useMemo} from "react"
import dynamic from "next/dynamic"

import clsx from "clsx"
import {Typography} from "antd"

import usePlayground from "../../../../hooks/usePlayground"
import {getEnhancedProperties} from "../../../../assets/utilities/genericTransformer/utilities/enhanced"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"

import type {GenerationCompletionRowProps} from "./types"
import GenerationOutputText from "../GenerationOutputText"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import RunButton from "@/components/NewPlayground/assets/RunButton"
import {useStyles} from "./styles"
import SharedEditor from "../../../SharedEditor"
import {getResponseLazy} from "@/components/NewPlayground/state"
const GenerationResultUtils = dynamic(() => import("../GenerationResultUtils"), {
    ssr: false,
})
const GenerationVariableOptions = dynamic(() => import("../GenerationVariableOptions"), {
    ssr: false,
})

const GenerationCompletionRow = ({
    variantId,
    rowId,
    className,
    inputOnly,
    view,
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

    const result = useMemo(() => {
        return getResponseLazy(resultHash)
    }, [resultHash])

    const runRow = useCallback(async () => {
        runTests?.(rowId, viewType === "single" ? variantId : undefined)
    }, [runTests, variantId, rowId, viewType])

    if (viewType === "single" && view !== "focus" && variantId) {
        return (
            <div
                className={clsx(["flex flex-col gap-4", "p-4", "group/item", classes.container])}
                {...props}
            >
                <div
                    className={clsx("flex gap-1 items-start", {
                        "flex flex-col gap-4 w-full": isChat,
                    })}
                >
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
                                />
                            )
                        })}
                    </div>

                    {!inputOnly && variableIds.length > 0 ? (
                        <GenerationVariableOptions
                            variantId={variantId}
                            rowId={rowId}
                            className="invisible group-hover/item:visible"
                            resultHash={resultHash}
                        />
                    ) : null}
                </div>

                {!inputOnly && variableIds.length > 0 ? (
                    <div className="w-full flex gap-1 items-start">
                        <div className="w-[100px] shrink-0">
                            <RunButton onClick={runRow} disabled={isRunning} />
                        </div>
                        <div className="flex flex-col gap-4">
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
                                />
                            ) : result.response ? (
                                <SharedEditor
                                    initialValue={result?.response?.data}
                                    editorType="borderless"
                                    state="filled"
                                    readOnly
                                    disabled
                                    className="!pt-0"
                                    editorClassName="min-h-4 [&_p:first-child]:!mt-0"
                                    footer={
                                        <GenerationResultUtils className="mt-2" result={result} />
                                    }
                                />
                            ) : null}
                        </div>
                        <div className="flex items-center w-[50px] shrink-0" />
                    </div>
                ) : null}
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

            {!inputOnly && variableIds.length > 0 ? (
                <div className={clsx("h-[48px] flex items-center px-4")}>
                    <RunButton onClick={runRow} disabled={isRunning} className="flex" />
                </div>
            ) : null}
        </>
    )
}

export default GenerationCompletionRow
