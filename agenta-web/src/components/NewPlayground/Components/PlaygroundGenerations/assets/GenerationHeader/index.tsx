import {useCallback, useState} from "react"
import dynamic from "next/dynamic"
import {Button, Typography} from "antd"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {SetStateAction} from "jotai"
import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import {
    ArrayMetadata,
    Enhanced,
    EnhancedObjectConfig,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {getMetadataLazy} from "@/components/NewPlayground/state"
import {InputType} from "@/components/NewPlayground/assets/utilities/transformer/types"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {GenerationHeaderProps} from "./types"
import {useStyles} from "./styles"
import clsx from "clsx"
import TestsetDrawerButton from "../../../Drawers/TestsetDrawer"
import RunButton from "@/components/NewPlayground/assets/RunButton"
const LoadTestsetModal = dynamic(() => import("../../../Modals/LoadTestsetModal"))

const GenerationHeader = ({variantId}: GenerationHeaderProps) => {
    const classes = useStyles()
    const {results, isRunning, mutate, runTests} = usePlayground({
        variantId,
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRows = state.generationData.value

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

    const wrappedSetTestsetData = useCallback((d: SetStateAction<Record<string, any> | null>) => {
        const data = Array.isArray(d) ? d : [d]

        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState

                // access the existing generation metadata to pull correct keys from testset rows
                const generationMetadata = clonedState.generationData.__metadata

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

                clonedState.generationData.value = newGenerationRows.filter(
                    (row) => !!row,
                ) as EnhancedObjectConfig<InputType<string[]>>[]

                return clonedState
            },
            {
                revalidate: false,
            },
        )

        setTestsetData(d)
    }, [])

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
