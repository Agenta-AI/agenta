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
}: GenerationComparisionCompletionOuputProps) => {
    const classes = useStyles()
    return (
        <>
            <div className={clsx("group/item", className)}>
                <PlaygroundComparisionGenerationOutputHeader />
                <div className={clsx("w-full h-24 p-2 relative", classes.containerBorder)}>
                    <GenerationOutputText text="Capital of Bangladesh is Dhaka" />

                    <GenerationFocusDrawerButton
                        variantIds={variantId}
                        className="absolute top-2 right-2"
                        disabled={focusDisable}
                    />
                </div>
                <div
                    className={clsx(
                        "w-ful h-[48px] flex items-center px-2",
                        classes.containerBorder,
                    )}
                >
                    <GenerationResultUtils />
                </div>
            </div>
        </>
    )
}

export default GenerationComparisionCompletionOuput
