import {Button, Typography} from "antd"
import clsx from "clsx"
import PlaygroundComparisionGenerationInputHeader from "../assets/GenerationComparisionInputHeader/index."
import {useStyles} from "../styles"
import {Play} from "@phosphor-icons/react"
import GenerationCompletion from "../../PlaygroundGenerations/assets/GenerationCompletion"

const GenerationComparisionCompletionInput = ({variantId, className}: any) => {
    const classes = useStyles()

    return (
        <div className={clsx(className)}>
            <PlaygroundComparisionGenerationInputHeader />
            <GenerationCompletion variantId={variantId} className="bg-[#f5f7fa]" />
        </div>
    )
}

export default GenerationComparisionCompletionInput
