import {useCallback} from "react"
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
import {getStringOrJson} from "@/lib/helpers/utils"
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
    const {result, variableIds, runTests, canRun, isRunning, viewType, isChat, inputText} =
        usePlayground({
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
                        isChat: state.variants[0]?.isChat,
                        inputText: variables?.[0]?.value, // Temporary implementation
                    }
                },
                [rowId, variantId],
            ),
        })

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

                    {!inputOnly && variableIds.length > 0 ? (
                        <GenerationVariableOptions
                            variantId={variantId}
                            rowId={rowId}
                            className="invisible group-hover/item:visible"
                            result={result}
                        />
                    ) : null}
                </div>

                {!inputOnly && variableIds.length > 0 ? (
                    <div className="w-full flex gap-1 items-start">
                        <div className="w-[100px] shrink-0">
                            <RunButton onClick={runRow} disabled={!canRun || isRunning} />
                        </div>
                        <div className="flex flex-col gap-4">
                            {isRunning ? (
                                <GenerationOutputText text="Running..." />
                            ) : !result ? (
                                <GenerationOutputText text="Click run to generate output" />
                            ) : result.error ? (
                                <GenerationOutputText
                                    type="danger"
                                    text={getStringOrJson(result?.metadata?.rawError)}
                                />
                            ) : result.response ? (
                                <>
                                    <GenerationOutputText text={result.response.data} />

                                    <GenerationResultUtils result={result} />
                                </>
                            ) : null}
                        </div>
                        <div className="flex items-center w-[100px] shrink-0" />
                    </div>
                ) : null}
            </div>
        )
    }

    return (
        <>
            <div className={clsx(["flex flex-col gap-4", classes.container, className])} {...props}>
                <div className="flex gap-1 items-start">
                    <div className="flex flex-col grow">
                        {variableIds.map((variableId) => {
                            return (
                                <div
                                    key={variableId}
                                    className="relative group/item h-24 py-2 px-4 overflow-y-auto [&::-webkit-scrollbar]:w-0"
                                >
                                    <PlaygroundVariantPropertyControl
                                        variantId={variantId}
                                        propertyId={variableId}
                                        view={view}
                                        rowId={rowId}
                                    />

                                    {!inputOnly && (
                                        <GenerationVariableOptions
                                            variantId={variantId as string}
                                            rowId={rowId}
                                            className="invisible group-hover/item:visible absolute top-2 right-1"
                                            result={result}
                                            inputText={inputText as string}
                                        />
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            </div>

            {!inputOnly && variableIds.length > 0 ? (
                <div
                    className={clsx(
                        "h-[48px] flex items-center px-4",
                        classes.container,
                        className,
                    )}
                >
                    <RunButton onClick={runRow} disabled={!canRun || isRunning} className="flex" />
                </div>
            ) : null}
        </>
    )
}

export default GenerationCompletionRow
