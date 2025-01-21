import {useCallback} from "react"
import {Copy, MinusCircle} from "@phosphor-icons/react"
import {Button} from "antd"
import {GenerationVariableOptionsProps} from "./types"
import clsx from "clsx"
import PlaygroundGenerationVariableMenu from "../../../Menus/PlaygroundGenerationVariableMenu"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import {getMetadataLazy} from "@/components/NewPlayground/state"
import {
    ArrayMetadata,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"
import {getEnhancedProperties} from "@/components/NewPlayground/assets/utilities/genericTransformer/utilities/enhanced"

const GenerationVariableOptions: React.FC<GenerationVariableOptionsProps> = ({
    rowId,
    variantId,
    className,
    result,
    variableId,
}) => {
    const {mutate, viewType, inputRows, variable} = usePlayground({
        variantId,
        hookId: "GenerationVariableOptions",
        stateSelector: useCallback((state: PlaygroundStateData) => {
            const inputRows = state.generationData.value || []
            const inputRow = inputRows.find((inputRow) => {
                return inputRow.__id === rowId
            })
            const variables = getEnhancedProperties(inputRow)
            const variable = variables.find((p) => p.__id === variableId)

            return {inputRows, variable}
        }, []),
    })

    const deleteInputRow = useCallback(() => {
        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState

                const generationRows = clonedState.generationData.value
                clonedState.generationData.value = generationRows.filter(
                    (row) => row.__id !== rowId,
                )

                return clonedState
            },
            {revalidate: false},
        )
    }, [])

    const duplicateInputRow = useCallback(() => {
        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState

                const _metadata = getMetadataLazy<ArrayMetadata>(
                    clonedState?.generationData.__metadata,
                )
                const itemMetadata = _metadata?.itemMetadata as ObjectMetadata

                if (!itemMetadata) return clonedState

                const inputKeys = Object.keys(itemMetadata.properties)
                const newRow = createInputRow(inputKeys, itemMetadata)

                const existingRow = clonedState?.generationData.value.find(
                    (row) => row.__id === rowId,
                )

                if (existingRow) {
                    inputKeys.forEach((key) => {
                        if (existingRow[key] !== undefined) {
                            newRow[key] = structuredClone(existingRow[key])
                        }
                    })
                }

                clonedState.generationData.value.push(newRow)

                return clonedState
            },
            {revalidate: false},
        )
    }, [])

    return (
        <div className={clsx("flex items-center gap-1 z-[2]", className)}>
            <Button
                icon={<MinusCircle size={14} />}
                type="text"
                onClick={deleteInputRow}
                size="small"
                disabled={inputRows.length === 1}
            />
            {viewType === "single" && (
                <PlaygroundGenerationVariableMenu
                    duplicateInputRow={duplicateInputRow}
                    result={result}
                />
            )}
            {viewType === "comparison" && (
                <Button
                    icon={<Copy size={14} />}
                    type="text"
                    onClick={() => navigator.clipboard.writeText(variable?.value as string)}
                    size="small"
                />
            )}
        </div>
    )
}

export default GenerationVariableOptions
