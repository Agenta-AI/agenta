import {cloneElement, isValidElement, SetStateAction, useCallback, useState} from "react"
import dynamic from "next/dynamic"
import {Button} from "antd"
import {Database} from "@phosphor-icons/react"
import {LoadTestsetButtonProps} from "./types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {getMetadataLazy} from "@/components/NewPlayground/state"
import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import {
    ArrayMetadata,
    Enhanced,
    EnhancedObjectConfig,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {InputType} from "@/components/NewPlayground/assets/utilities/transformer/types/input"
const LoadTestsetModal = dynamic(() => import("../.."), {ssr: false})

const LoadTestsetButton = ({label, icon = false, children, ...props}: LoadTestsetButtonProps) => {
    const {mutate} = usePlayground()

    const [isTestsetModalOpen, setIsTestsetModalOpen] = useState(false)
    const [testsetData, setTestsetData] = useState<Record<string, any> | null>(null)

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

    return (
        <>
            {isValidElement(children) ? (
                cloneElement(
                    children as React.ReactElement<{
                        onClick: () => void
                    }>,
                    {
                        onClick: () => {
                            setIsTestsetModalOpen(true)
                        },
                    },
                )
            ) : (
                <Button
                    size="small"
                    icon={icon && <Database size={14} />}
                    onClick={() => setIsTestsetModalOpen(true)}
                    {...props}
                >
                    {label}
                </Button>
            )}

            <LoadTestsetModal
                open={isTestsetModalOpen}
                onCancel={() => setIsTestsetModalOpen(false)}
                testsetData={testsetData}
                setTestsetData={wrappedSetTestsetData}
            />
        </>
    )
}

export default LoadTestsetButton
