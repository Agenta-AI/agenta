import {useCallback} from "react"

import {Copy, MinusCircle} from "@phosphor-icons/react"
import {Button} from "antd"
import clsx from "clsx"

import {getMetadataLazy} from "@/oss/lib/hooks/useStatelessVariants/state"
import {getEnhancedProperties} from "@/oss/lib/shared/variant"
import type {ArrayMetadata, ObjectMetadata} from "@/oss/lib/shared/variant/genericTransformer/types"
import {createInputRow} from "@/oss/lib/shared/variant/inputHelpers"

import usePlayground from "../../../../hooks/usePlayground"
import {PlaygroundStateData} from "../../../../hooks/usePlayground/types"
import PlaygroundGenerationVariableMenu from "../../../Menus/PlaygroundGenerationVariableMenu"

import type {GenerationVariableOptionsProps} from "./types"

const GenerationVariableOptions: React.FC<GenerationVariableOptionsProps> = ({
    rowId,
    variantId,
    className,
    resultHash,
    variableId,
}) => {
    const {mutate, viewType, inputRows, variable} = usePlayground({
        variantId,
        hookId: "GenerationVariableOptions",
        stateSelector: useCallback(
            (state: PlaygroundStateData) => {
                const inputRows = state.generationData.inputs.value || []
                const inputRow = inputRows.find((inputRow) => {
                    return inputRow.__id === rowId
                })
                const variables = getEnhancedProperties(inputRow)
                const variable = variables.find((p) => p.__id === variableId)

                return {inputRows, variable}
            },
            [rowId, variableId],
        ),
    })

    const deleteInputRow = useCallback(() => {
        mutate(
            (clonedState) => {
                if (!clonedState) return clonedState

                const generationRows = clonedState.generationData.inputs.value
                clonedState.generationData.inputs.value = generationRows.filter(
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
                    clonedState?.generationData.inputs.__metadata,
                )
                const itemMetadata = _metadata?.itemMetadata as ObjectMetadata

                if (!itemMetadata) return clonedState

                const inputKeys = Object.keys(
                    itemMetadata.properties,
                ) as (keyof typeof existingRow)[]
                const newRow = createInputRow(inputKeys, itemMetadata)

                const existingRow = clonedState?.generationData.inputs.value.find(
                    (row) => row.__id === rowId,
                )

                if (existingRow) {
                    inputKeys.forEach((key) => {
                        if (existingRow[key] !== undefined) {
                            newRow[key] = structuredClone(existingRow[key])
                        }
                    })
                }

                clonedState.generationData.inputs.value.push(newRow)

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
                    resultHash={resultHash}
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
