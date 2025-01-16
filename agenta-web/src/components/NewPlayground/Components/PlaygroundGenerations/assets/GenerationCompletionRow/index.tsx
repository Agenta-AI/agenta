import {useCallback} from "react"
import dynamic from "next/dynamic"

import clsx from "clsx"
import {Play} from "@phosphor-icons/react"
import {Typography, Button} from "antd"

import usePlayground from "../../../../hooks/usePlayground"
import {getEnhancedProperties} from "../../../../assets/utilities/genericTransformer/utilities/enhanced"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"

import type {GenerationCompletionRowProps} from "./types"
import GenerationOutputText from "../GenerationOutputText"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
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
    const {result, variableIds, runTests, canRun, isRunning, viewType, variant} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRow = state.generationData.value.find((inputRow) => {
                    return inputRow.__id === rowId
                })

                const variables = getEnhancedProperties(inputRow)
                const variableIds = variables.map((p) => p.__id)
                const canRun = variables.reduce((acc, curr) => acc && !!curr.value, true)

                const result = variantId ? inputRow?.__runs?.[variantId]?.__result : null
                const isRunning = variantId ? inputRow?.__runs?.[variantId]?.__isRunning : false

                return {
                    variableIds,
                    canRun,
                    result,
                    isRunning,
                }
            },
            [rowId],
        ),
    })

    const runRow = useCallback(async () => {
        runTests?.(rowId, variantId)
    }, [runTests, variantId, rowId])

    if (viewType === "single" && view !== "focus" && variantId) {
        return (
            <div
                className={clsx([
                    "flex flex-col gap-4",
                    "p-4",
                    "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    "group/item",
                ])}
                {...props}
            >
                <div
                    className={clsx("flex gap-1 items-start", {
                        "flex flex-col gap-4 w-full": variant?.isChat,
                    })}
                >
                    <div className="w-[100px]">
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

                    {!inputOnly && (
                        <GenerationVariableOptions
                            variantId={variantId}
                            rowId={rowId}
                            className="invisible group-hover/item:visible"
                            result={result}
                        />
                    )}
                </div>

                {!inputOnly && (
                    <div className="w-full flex gap-1 items-start">
                        <div className="w-[100px] shrink-0">
                            <Button
                                onClick={runRow}
                                variant="outlined"
                                color="default"
                                className="self-start"
                                disabled={!canRun || isRunning}
                                size="small"
                            >
                                <Play size={14} />
                                Run
                            </Button>
                        </div>
                        <div className="flex flex-col gap-4">
                            {isRunning ? (
                                <GenerationOutputText text="Running..." />
                            ) : !result ? (
                                <GenerationOutputText text="Click run to generate output" />
                            ) : result.error ? (
                                <GenerationOutputText type="danger" text={result.error} />
                            ) : result.response ? (
                                <>
                                    <GenerationOutputText
                                        type="success"
                                        text={result.response.data}
                                    />

                                    <GenerationResultUtils />
                                </>
                            ) : null}
                        </div>
                        <div className="flex items-center w-[100px] shrink-0" />
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
                    "p-2",
                    "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
                    "group/item h-24",
                    className,
                ])}
                {...props}
            >
                <div className="flex gap-1 items-start">
                    <div className="flex flex-col grow gap-2">
                        {variableIds.map((variableId) => {
                            return (
                                <PlaygroundVariantPropertyControl
                                    key={variableId}
                                    variantId={variantId}
                                    propertyId={variableId}
                                    view={view}
                                    rowId={rowId}
                                />
                            )
                        })}
                    </div>
                </div>
            </div>

            {!inputOnly && (
                <div
                    className={clsx(
                        "border-0 border-b border-solid border-[rgba(5,23,41,0.06)] h-[48px] flex items-center px-2",
                        className,
                    )}
                >
                    <Button
                        onClick={runRow}
                        disabled={!canRun || isRunning}
                        size="small"
                        icon={<Play size={14} />}
                    >
                        Run
                    </Button>
                </div>
            )}
        </>
    )
}

export default GenerationCompletionRow
