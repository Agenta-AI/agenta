import {memo, useCallback} from "react"
import {Typography} from "antd"
import clsx from "clsx"
import {useStyles} from "../styles"
import {GenerationComparisonOutputHeaderProps} from "./types"
import Version from "@/components/NewPlayground/assets/Version"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"

const GenerationComparisonOutputHeader: React.FC<GenerationComparisonOutputHeaderProps> = ({
    className,
    variantId,
}) => {
    const {variantName, revision} = usePlayground({
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const variant = state.variants.find((variant) => variant.id === variantId)
                return {variantName: variant?.variantName, revision: variant?.revision}
            },
            [variantId],
        ),
    })
    const classes = useStyles()

    return (
        <div className={clsx(classes.title, className)}>
            <Typography>{variantName}</Typography>
            <Version revision={revision as number} />
        </div>
    )
}

export default memo(GenerationComparisonOutputHeader)
