import {useCallback} from "react"
import dynamic from "next/dynamic"
import clsx from "clsx"
import {useStyles} from "../styles"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import {GenerationComparisonCompletionOutputProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {getStringOrJson} from "@/lib/helpers/utils"
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
    isLastRow,
    isLastVariant,
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
        <>
            <div
                className={clsx([
                    "border-0 border-r border-solid border-[rgba(5,23,41,0.06)] bg-white sticky left-0 z-[3]",
                    {"border-b": !isLastRow},
                ])}
            >
                {variantIndex === 0 && (
                    <div className="!w-[399px] shrink-0 sticky top-9 z-[2]">
                        <GenerationCompletion
                            variantId={variantId}
                            rowId={rowId}
                            withControls={isLastRow}
                        />
                    </div>
                )}
            </div>

            <div
                className={clsx([
                    "border-0 border-solid border-[rgba(5,23,41,0.06)]",
                    {"border-r": isLastVariant},
                    {"border-b": !isLastRow},
                ])}
            >
                <div className="flex sticky top-9 z-[2]">
                    <div className="!w-[399px]">
                        <div className={clsx("w-full py-2 px-4")}>
                            {isRunning ? (
                                <GenerationOutputText text="Running..." />
                            ) : !result ? (
                                <GenerationOutputText text="Click To generate" />
                            ) : result.error ? (
                                <GenerationOutputText
                                    type="danger"
                                    text={
                                        "Lorem ipsum dolor sit Lorem ipsum dolor sit amet consectetur adipisicing elit. Itaque possimus nisi dolorum repellendus aperiam dolor, ipsa saepe eos ut veritatis id laborum obcaecati aut, cum adipisci voluptatem? Officiis aut, ex excepturi aliquam ipsa ipsam obcaecati? Nisi, blanditiis eos totam iure magni laboriosam, omnis eligendi porro error reprehenderit consequuntur! Excepturi, quibusdam. Lorem ipsum dolor sit amet consectetur adipisicing elit. Itaque possimus nisi dolorum repellendus aperiam dolor, ipsa saepe eos ut veritatis id laborum obcaecati aut, cum adipisci voluptatem? Officiis aut, ex excepturi aliquam ipsa ipsam obcaecati? Nisi, blanditiis eos totam iure magni laboriosam, omnis eligendi porro error reprehenderit consequuntur! Excepturi, quibusdam. amet consectetur adipisicing elit. Itaque possimus nisi dolorum repellendus aperiam dolor, ipsa saepe eos ut veritatis id laborum obcaecati aut, cum adipisci voluptatem? Officiis aut, ex excepturi aliquam ipsa ipsam obcaecati? Nisi, blanditiis eos totam iure magni laboriosam, omnis eligendi porro error reprehenderit consequuntur! Excepturi, quibusdam. Lorem ipsum dolor sit amet consectetur adipisicing elit. Itaque possimus nisi dolorum repellendus aperiam dolor, ipsa saepe eos ut veritatis id laborum obcaecati aut, cum adipisci voluptatem? Officiis aut, ex excepturi aliquam ipsa ipsam obcaecati? Nisi, blanditiis eos totam iure magni laboriosam, omnis eligendi porro error reprehenderit consequuntur! Excepturi, quibusdam."
                                    }
                                />
                            ) : result.response ? (
                                <GenerationOutputText text={result.response.data} />
                            ) : null}
                        </div>

                        {result?.response && (
                            <div className={clsx("w-ful h-[48px] flex items-center px-2")}>
                                <GenerationResultUtils result={result} />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </>
    )
}

export default GenerationComparisonCompletionOutput
