import {useCallback, useState} from "react"

import clsx from "clsx"
import dynamic from "next/dynamic"
import {Button, Typography} from "antd"
import {SetStateAction} from "jotai"

import TestsetDrawerButton from "../../../Drawers/TestsetDrawer"
import RunButton from "../../../../assets/RunButton"
import usePlayground from "../../../../hooks/usePlayground"
import {useStyles} from "./styles"
import {clearRuns} from "@/components/NewPlayground/hooks/usePlayground/assets/generationHelpers"
import {createInputRow} from "../../../../hooks/usePlayground/assets/inputHelpers"
import {getMetadataLazy} from "../../../../state"

import type {PlaygroundStateData} from "../../../../hooks/usePlayground/types"
import type {GenerationHeaderProps} from "./types"
import type {InputType} from "@/components/NewPlayground/assets/utilities/transformer/types"
import type {
    ArrayMetadata,
    Enhanced,
    EnhancedObjectConfig,
    ObjectMetadata,
} from "../../../../assets/utilities/genericTransformer/types"

const LoadTestsetModal = dynamic(() => import("../../../Modals/LoadTestsetModal"))

const GenerationHeader = ({variantId}: GenerationHeaderProps) => {
    const classes = useStyles()
    const {results, isRunning, mutate, runTests} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRows = state.generationData.inputs.value

                // TODO: use the results to get all the responses to save on the Testset
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

    const [testsetData, setTestsetData] = useState<Record<string, any> | null>(null)
    const [isTestsetModalOpen, setIsTestsetModalOpen] = useState(false)

    const wrappedSetTestsetData = useCallback(
        (d: SetStateAction<Record<string, any> | null>) => {
            const data = Array.isArray(d) ? d : [d]

            mutate(
                (clonedState) => {
                    if (!clonedState) return clonedState

                    // access the existing generation metadata to pull correct keys from testset rows
                    const generationMetadata = clonedState.generationData.inputs.__metadata

                    // loop through the testset rows and create new generation rows from them
                    const newGenerationRows = data.map((row) => {
                        const parentMetadata =
                            getMetadataLazy<ArrayMetadata<ObjectMetadata>>(generationMetadata)
                        const metadata = parentMetadata?.itemMetadata

                        if (!metadata) return null

                        const inputKeys = Object.keys(metadata.properties)
                        const newRow = createInputRow(inputKeys, metadata)

                        // set the values of the new generation row inputs to the values of the testset row
                        for (const key of inputKeys) {
                            const newRowProperty = newRow[key] as Enhanced<string>
                            newRowProperty.value = row[key]
                        }

                        return newRow
                    })

                    clonedState.generationData.inputs.value = newGenerationRows.filter(
                        (row) => !!row,
                    ) as EnhancedObjectConfig<InputType<string[]>>[]

                    return clonedState
                },
                {
                    revalidate: false,
                },
            )

            setTestsetData(d)
        },
        [mutate],
    )

    const clearGeneration = useCallback(() => {
        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState
                clearRuns(clonedState)
                return clonedState
            },
            {revalidate: false},
        )
    }, [mutate])

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
                <Button size="small" onClick={() => setIsTestsetModalOpen(true)}>
                    Load Test set
                </Button>

                <TestsetDrawerButton
                    label="Add all to test set"
                    icon={false}
                    size="small"
                    disabled={isRunning || !results?.[0]?.response?.data}
                    results={results}
                />

                <RunButton
                    isRunAll
                    type="primary"
                    onClick={() => runTests?.()}
                    disabled={isRunning}
                />
            </div>

            <LoadTestsetModal
                open={isTestsetModalOpen}
                onCancel={() => setIsTestsetModalOpen(false)}
                testsetData={testsetData}
                setTestsetData={wrappedSetTestsetData}
            />
        </section>
    )
}

export default GenerationHeader
