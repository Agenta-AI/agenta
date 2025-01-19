import clsx from "clsx"
import {useStyles} from "../styles"
import GenerationComparisonOutputHeader from "../assets/GenerationComparisonOutputHeader"
import GenerationResultUtils from "../../PlaygroundGenerations/assets/GenerationResultUtils"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import {GenerationComparisonCompletionOutputProps} from "./types"
import GenerationFocusDrawerButton from "../../Drawers/GenerationFocusDrawer/assets/GenerationFocusDrawerButton"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {useCallback} from "react"
import {getYamlOrJson} from "@/lib/helpers/utils"
import {OutputFormat} from "../../Drawers/GenerationFocusDrawer/types"
import {getEnhancedProperties} from "@/components/NewPlayground/assets/utilities/genericTransformer/utilities/enhanced"

const GenerationComparisonCompletionOutputRow = ({
    rowId,
    focusDisable,
    className,
    variantId,
    format,
}: {
    rowId: string
    focusDisable: boolean
    className?: string
    variantId: string
    format?: OutputFormat
}) => {
    const classes = useStyles()
    const {result, isRunning, variableIds} = usePlayground({
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRow = state.generationData.inputs.value.find((inputRow) => {
                    return inputRow.__id === rowId
                })
                const variantRun = inputRow?.__runs?.[variantId]
                const variables = getEnhancedProperties(inputRow)
                const variableIds = variables.map((p) => p.__id)

                return {
                    result: variantRun?.__result,
                    isRunning: variantRun?.__isRunning,
                    variableIds,
                }
            },
            [rowId, variantId],
        ),
    })

    /*
      The container height is calculated to ensure that the Output-component and Input-component heights are synchronized.
      - 96 represents the static height of each input container.
      - 1 accounts for the border height of each input container.
      - 48 is the height of the Run button section in the input container, which is only added when there is no response.

      If there is a response, the height is calculated as:
      containerHeight = variableIds.length * 96 + 1

      If there is no response, the height includes the Run button section:
      containerHeight = variableIds.length * 96 + 1 + 48
   */
    const containerHeight = result?.response
        ? variableIds.length * 96 + 1
        : variableIds.length * 96 + 1 + 48

    return (
        <div className={className}>
            <div
                style={{height: containerHeight}}
                className={clsx(
                    "w-full py-2 px-4 relative group/item overflow-y-auto [&::-webkit-scrollbar]:w-0",
                    classes.containerBorder,
                )}
            >
                {isRunning ? (
                    <GenerationOutputText text="Running..." />
                ) : !result ? (
                    <GenerationOutputText text="Click run to generate output" />
                ) : result.error ? (
                    <GenerationOutputText
                        type="danger"
                        text={
                            !format || format === "PRETTY"
                                ? result.error
                                : getYamlOrJson(
                                      format as "JSON" | "YAML",
                                      result?.metadata?.rawError,
                                  )
                        }
                    />
                ) : result.response ? (
                    <GenerationOutputText text={result.response.data} />
                ) : null}

                {!focusDisable && (
                    <GenerationFocusDrawerButton
                        variantIds={variantId}
                        className="absolute top-1.5 right-2 invisible group-hover/item:visible"
                        size="small"
                        rowId=""
                    />
                )}
            </div>

            {result?.response && (
                <div
                    className={clsx(
                        "w-ful h-[48px] flex items-center px-2",
                        classes.containerBorder,
                    )}
                >
                    <GenerationResultUtils result={result} />
                </div>
            )}
        </div>
    )
}

const GenerationComparisonCompletionOutput = ({
    variantId,
    className,
    focusDisable = false,
    result,
    isRunning,
    indexName,
}: GenerationComparisonCompletionOutputProps) => {
    const {inputRowIds} = usePlayground({
        stateSelector: (state) => {
            const inputRows = state.generationData.inputs.value || []
            return {
                inputRowIds: inputRows.map((inputRow) => inputRow.__id),
            }
        },
    })

    return (
        <div className="flex flex-col w-full">
            <GenerationComparisonOutputHeader
                variantId={variantId}
                indexName={indexName}
                className="sticky top-0 z-[1]"
            />

            {inputRowIds.map((inputRowId) => {
                return (
                    <GenerationComparisonCompletionOutputRow
                        key={inputRowId}
                        variantId={variantId}
                        rowId={inputRowId}
                        className={className}
                        focusDisable={focusDisable}
                    />
                )
            })}
        </div>
    )
}

export default GenerationComparisonCompletionOutput
