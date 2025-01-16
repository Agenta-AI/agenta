import {useCallback, useState} from "react"
import dynamic from "next/dynamic"
import {Play} from "@phosphor-icons/react"
import {Button, Typography} from "antd"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {SetStateAction} from "jotai"
import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import {Enhanced} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {GenerationHeaderProps} from "./types"
const LoadTestsetModal = dynamic(() => import("../../../Modals/LoadTestsetModal"))
import {getMetadataLazy} from "@/components/NewPlayground/state"

const GenerationHeader = ({variantId}: GenerationHeaderProps) => {
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
            (state) => {
                const clonedState = structuredClone(state)
                if (!clonedState) return state

                // access the existing generation metadata to pull correct keys from testset rows
                const generationMetadata = clonedState.generationData.__metadata

                // loop through the testset rows and create new generation rows from them
                const newGenerationRows = data.map((row) => {
                    const metadata = getMetadataLazy(generationMetadata)?.itemMetadata
                    const inputKeys = Object.keys(metadata.properties)
                    const newRow = createInputRow(inputKeys, metadata)

                    // set the values of the new generation row inputs to the values of the testset row
                    for (const key of inputKeys) {
                        const newRowProperty = newRow[key] as Enhanced<string>
                        newRowProperty.value = row[key]
                    }

                    return newRow
                })

                clonedState.generationData.value = newGenerationRows

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
            (state) => {
                const clonedState = structuredClone(state)
                if (!clonedState) return state

                const generationMetadata = clonedState.generationData.__metadata
                const metadata = getMetadataLazy(generationMetadata)?.itemMetadata
                const inputKeys = Object.keys(metadata.properties)
                const newRow = createInputRow(inputKeys, metadata)
                clonedState.generationData.value = [newRow]

                return clonedState
            },
            {revalidate: false},
        )
    }, [])

    return (
        <section className="h-[48px] flex justify-between items-center gap-4 px-4 py-2 border-0 border-b border-solid border-[rgba(5,23,41,0.06)]">
            <Typography className="text-[16px] leading-[18px] font-[600]">Generations</Typography>

            <div className="flex items-center gap-2">
                <Button size="small" onClick={clearGeneration} disabled={isRunning}>
                    Clear
                </Button>
                <Button size="small" onClick={() => setIsTestsetModalOpen(true)}>
                    Load Test set
                </Button>

                <Button size="small" disabled={isRunning || !results?.[0]?.response?.data}>
                    Add all to test set
                </Button>

                <Button
                    size="small"
                    type="primary"
                    icon={<Play size={14} />}
                    onClick={() => runTests?.()}
                    loading={isRunning}
                >
                    Run all
                </Button>
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
