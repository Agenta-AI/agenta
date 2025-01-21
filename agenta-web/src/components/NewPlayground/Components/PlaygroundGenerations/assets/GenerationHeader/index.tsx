import {useCallback} from "react"
import {Button, Typography} from "antd"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"

import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import {
    ArrayMetadata,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {getMetadataLazy} from "@/components/NewPlayground/state"

import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {GenerationHeaderProps} from "./types"
import {useStyles} from "./styles"
import clsx from "clsx"
import TestsetDrawerButton from "../../../Drawers/TestsetDrawer"
import RunButton from "@/components/NewPlayground/assets/RunButton"
import LoadTestsetButton from "../../../Modals/LoadTestsetModal/assets/LoadTestsetButton"

const GenerationHeader = ({variantId}: GenerationHeaderProps) => {
    const classes = useStyles()
    const {results, isRunning, mutate, runTests} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRows = state.generationData.value

                const results = inputRows.map((inputRow) =>
                    variantId ? inputRow?.__runs?.[variantId]?.__result : null,
                )

                const isRunning = inputRows.some((inputRow) =>
                    variantId ? inputRow?.__runs?.[variantId]?.__isRunning : false,
                )

                return {results, isRunning}
            },
            [variantId],
        ),
    })

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
            className={clsx("h-[48px] flex justify-between items-center gap-4", classes.container)}
        >
            <Typography className="text-[16px] leading-[18px] font-[600] text-nowrap">
                Generations
            </Typography>

            <div className="flex items-center gap-2">
                <Button size="small" onClick={clearGeneration} disabled={isRunning}>
                    Clear
                </Button>

                <LoadTestsetButton label="Load Test set" />

                <TestsetDrawerButton
                    label="Add all to test set"
                    icon={false}
                    size="small"
                    disabled={isRunning}
                    results={results}
                />

                <RunButton
                    isRunAll
                    type="primary"
                    onClick={() => runTests?.()}
                    disabled={isRunning}
                />
            </div>
        </section>
    )
}

export default GenerationHeader
