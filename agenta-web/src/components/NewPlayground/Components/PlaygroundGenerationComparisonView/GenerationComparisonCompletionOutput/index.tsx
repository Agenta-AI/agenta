import {useCallback} from "react"
import clsx from "clsx"
import {useStyles} from "../styles"
import GenerationResultUtils from "../../PlaygroundGenerations/assets/GenerationResultUtils"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import {GenerationComparisonCompletionOutputProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {getStringOrJson} from "@/lib/helpers/utils"
import {getEnhancedProperties} from "@/components/NewPlayground/assets/utilities/genericTransformer/utilities/enhanced"

const GenerationComparisonCompletionOutput = ({
    rowId,
    focusDisable = false,
    className,
    variantId,
}: GenerationComparisonCompletionOutputProps) => {
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
                        text={getStringOrJson(result?.metadata?.rawError)}
                    />
                ) : result.response ? (
                    <GenerationOutputText text={result.response.data} />
                ) : null}
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

export default GenerationComparisonCompletionOutput
