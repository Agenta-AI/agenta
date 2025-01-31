import {useCallback} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import {useStyles} from "../styles"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import {GenerationComparisonCompletionOutputProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {getStringOrJson} from "@/lib/helpers/utils"
import {getEnhancedProperties} from "@/components/NewPlayground/assets/utilities/genericTransformer/utilities/enhanced"
import GenerationCompletionRow from "../../PlaygroundGenerations/assets/GenerationCompletionRow"
import {findPropertyInObject} from "@/lib/hooks/useStatelessVariant/assets/helpers"
import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"
const GenerationResultUtils = dynamic(
    () => import("../../PlaygroundGenerations/assets/GenerationResultUtils"),
    {ssr: false},
)

const GenerationComparisonCompletionOutput = ({
    rowId,
    focusDisable = false,
    className,
    variantId,
    variantIndex,
}: GenerationComparisonCompletionOutputProps) => {
    const classes = useStyles()
    const {result, isRunning, inputRow} = usePlayground({
        registerToWebWorker: true,
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRow = findPropertyInObject(state, rowId)
                const variantRun = inputRow?.__runs?.[variantId]
                return {
                    result: variantRun?.__result,
                    isRunning: variantRun?.__isRunning,
                    inputRow,

                    variantRun,
                }
            },
            [rowId, variantId],
        ),
    })

    return (
        <section className="flex">
            <div className="!w-[400px] shrink-0">
                <GenerationCompletion variantId={variantId} />
            </div>

            <div className="!w-[400px] shrink-0">
                <div
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
        </section>
    )
}

export default GenerationComparisonCompletionOutput
