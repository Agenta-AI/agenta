import {memo, useCallback} from "react"

import {Typography} from "antd"
import clsx from "clsx"

import Version from "@/oss/components/NewPlayground/assets/Version"
import usePlayground from "@/oss/components/NewPlayground/hooks/usePlayground"
import {PlaygroundStateData} from "@/oss/components/NewPlayground/hooks/usePlayground/types"

import {useStyles} from "../styles"

import {GenerationComparisonOutputHeaderProps} from "./types"

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
