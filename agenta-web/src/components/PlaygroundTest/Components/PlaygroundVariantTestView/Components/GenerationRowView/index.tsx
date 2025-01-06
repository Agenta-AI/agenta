import {useCallback} from "react"

import clsx from "clsx"
import {Play} from "@phosphor-icons/react"
import {Typography, Button} from "antd"

import usePlayground from "../../../../hooks/usePlayground"
import {getEnhancedProperties} from "../../../../assets/utilities/genericTransformer/utilities/enhanced"
import PlaygroundVariantPropertyControl from "../../../PlaygroundVariantPropertyControl"

import type {GenerationRowViewProps} from "./types"
import type {EnhancedVariant} from "../../../../assets/utilities/transformer/types"

const GenerationRowView = ({variantId, rowId, ...props}: GenerationRowViewProps) => {
    const {result, variableIds, runVariantTestRow, canRun, isRunning} = usePlayground({
        variantId,
        variantSelector: useCallback(
            (variant: EnhancedVariant) => {
                const inputRow = (variant.inputs?.value || []).find((inputRow) => {
                    return inputRow.__id === rowId
                })

                const variables = getEnhancedProperties(inputRow)
                const variableIds = variables.map((p) => p.__id)
                const canRun = variables.reduce((acc, curr) => acc && !!curr.value, true)

                return {
                    variableIds,
                    canRun,
                    result: inputRow?.__result,
                    isRunning: inputRow?.__isLoading,
                }
            },
            [rowId],
        ),
    })

    const runRow = useCallback(async () => {
        await runVariantTestRow?.(rowId)
    }, [runVariantTestRow, rowId])

    return (
        <div
            className={clsx([
                "flex flex-col gap-4",
                "p-4",
                "border-0 border-b border-solid border-[rgba(5,23,41,0.06)]",
            ])}
            {...props}
        >
            <div className="flex gap-1 items-start">
                <div className="w-[100px]">
                    <Typography className="font-[500] text-[12px] leading-[20px]">
                        Variables
                    </Typography>
                </div>
                <div className="flex flex-col grow gap-2">
                    {variableIds.map((variableId) => {
                        return (
                            <PlaygroundVariantPropertyControl
                                key={variableId}
                                variantId={variantId}
                                propertyId={variableId}
                            />
                        )
                    })}
                </div>
                <div className="flex items-center w-[100px]">actions</div>
            </div>
            <div className="w-full flex gap-1 items-start">
                <div className="w-[100px] shrink-0">
                    <Button
                        onClick={runRow}
                        variant="outlined"
                        color="default"
                        className="self-start"
                        disabled={!canRun || isRunning}
                    >
                        <Play size={14} />
                        Run
                    </Button>
                </div>
                <div>
                    {isRunning ? (
                        <Typography className="font-[400] text-[12px] leading-[20px] text-[#BDC7D1]">
                            Running...
                        </Typography>
                    ) : !result ? (
                        <Typography className="font-[400] text-[12px] leading-[20px] text-[#BDC7D1]">
                            Click run to generate output
                        </Typography>
                    ) : result.error ? (
                        <Typography className="font-[400] text-[12px] leading-[20px] text-[#D61010]">
                            {result.error}
                        </Typography>
                    ) : result.response ? (
                        <Typography className="font-[400] text-[12px] leading-[20px]">
                            {result.response.data}
                        </Typography>
                    ) : null}
                </div>
                <div className="flex items-center w-[100px] shrink-0" />
            </div>
        </div>
    )
}

export default GenerationRowView
