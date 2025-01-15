import clsx from "clsx"
import {useStyles} from "../styles"
import PlaygroundComparisionGenerationOutputHeader from "../assets/GenerationComparisionOutputHeader"
import GenerationResultUtils from "../../PlaygroundGenerations/assets/GenerationResultUtils"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import {GenerationComparisionCompletionOuputProps} from "./types"
import GenerationFocusDrawerButton from "../../Drawers/GenerationFocusDrawer/components/GenerationFocusDrawerButton"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {useCallback} from "react"

const GenerationComparisionCompletionOuputRow = ({
    rowId,
    focusDisable,
    className,
    variantId,
}: {
    rowId: string
    focusDisable: boolean
    className?: string
    variantId: string
}) => {
    const classes = useStyles()
    const {result, isRunning} = usePlayground({
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRow = state.generationData.value.find((inputRow) => {
                    return inputRow.__id === rowId
                })
                const variantRun = inputRow?.__runs?.[variantId]
                return {
                    result: variantRun?.__result,
                    isRunning: variantRun?.__isRunning,
                }
            },
            [rowId, variantId],
        ),
    })

    console.log("GenerationComparisionCompletionOuputRow", result, isRunning)
    return (
        <div className={clsx("group/item", className)}>
            <PlaygroundComparisionGenerationOutputHeader />

            <div className={clsx("w-full h-24 py-2 px-4 relative", classes.containerBorder)}>
                {isRunning ? (
                    <GenerationOutputText text="Running..." />
                ) : !result ? (
                    <GenerationOutputText text="Click run to generate output" />
                ) : result.error ? (
                    <GenerationOutputText type="danger" text={result.error} />
                ) : result.response ? (
                    <GenerationOutputText type="success" text={result.response.data} />
                ) : null}

                {!focusDisable && (
                    <GenerationFocusDrawerButton
                        variantIds={variantId}
                        className="absolute top-2 right-2"
                        rowId=""
                    />
                )}

                {result?.response && (
                    <div
                        className={clsx(
                            "w-ful h-[48px] flex items-center px-2",
                            classes.containerBorder,
                        )}
                    >
                        <GenerationResultUtils />
                    </div>
                )}
            </div>
        </div>
    )
}

const GenerationComparisionCompletionOuput = ({
    variantId,
    className,
    focusDisable = false,
    result,
    isRunning,
}: GenerationComparisionCompletionOuputProps) => {
    const {inputRowIds} = usePlayground({
        stateSelector: (state) => {
            const inputRows = state.generationData.value || []
            return {
                inputRowIds: inputRows.map((inputRow) => inputRow.__id),
            }
        },
    })

    return (
        <>
            {inputRowIds.map((inputRowId) => {
                return (
                    <GenerationComparisionCompletionOuputRow
                        key={inputRowId}
                        variantId={variantId}
                        rowId={inputRowId}
                        className={className}
                        focusDisable={focusDisable}
                    />
                )
            })}
        </>
    )
}

export default GenerationComparisionCompletionOuput
