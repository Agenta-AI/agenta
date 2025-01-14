import clsx from "clsx"
import {useStyles} from "../styles"
import PlaygroundComparisionGenerationOutputHeader from "../assets/GenerationComparisionOutputHeader"
import GenerationResultUtils from "../../PlaygroundGenerations/assets/GenerationResultUtils"
import GenerationOutputText from "../../PlaygroundGenerations/assets/GenerationOutputText"
import {GenerationComparisionCompletionOuputProps} from "./types"
import GenerationFocusDrawerButton from "../../Drawers/GenerationFocusDrawer/components/GenerationFocusDrawerButton"

const GenerationComparisionCompletionOuput = ({
    variantId,
    className,
    focusDisable = false,
    result,
    isRunning,
}: GenerationComparisionCompletionOuputProps) => {
    const classes = useStyles()
    return (
        <>
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
                </div>

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
        </>
    )
}

export default GenerationComparisionCompletionOuput
