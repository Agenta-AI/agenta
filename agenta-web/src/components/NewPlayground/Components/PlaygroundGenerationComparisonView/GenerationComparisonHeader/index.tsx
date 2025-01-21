import {memo, useCallback} from "react"
import {Button, Typography} from "antd"
import {GenerationComparisonHeaderProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {getMetadataLazy} from "@/components/NewPlayground/state"
import {
    ArrayMetadata,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import {useStyles} from "./styles"
import clsx from "clsx"
import RunButton from "@/components/NewPlayground/assets/RunButton"
import LoadTestsetButton from "../../Modals/LoadTestsetModal/assets/LoadTestsetButton"

const GenerationComparisonHeader = ({className}: GenerationComparisonHeaderProps) => {
    const classes = useStyles()
    const {runTests, mutate} = usePlayground()

    const clearGeneration = useCallback(() => {
        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState

                const generationMetadata = clonedState.generationData.__metadata
                const metadata =
                    getMetadataLazy<ArrayMetadata<ObjectMetadata>>(generationMetadata)?.itemMetadata
                if (!metadata) return clonedState

                const inputKeys = Object.keys(metadata.properties)
                const newRow = createInputRow(inputKeys, metadata)
                clonedState.generationData.value = [newRow]

                return clonedState
            },
            {revalidate: false},
        )
    }, [])

    return (
        <section
            className={clsx(
                "flex items-center justify-between gap-2 px-4 py-2 h-[40px]",
                classes.header,
                className,
            )}
        >
            <Typography className={classes.heading}>Generations</Typography>

            <div className="flex items-center gap-2">
                <Button size="small" onClick={clearGeneration}>
                    Clear
                </Button>
                <LoadTestsetButton label="Load Test set" />
                <RunButton type="primary" onClick={() => runTests?.()} />
            </div>
        </section>
    )
}

export default memo(GenerationComparisonHeader)
