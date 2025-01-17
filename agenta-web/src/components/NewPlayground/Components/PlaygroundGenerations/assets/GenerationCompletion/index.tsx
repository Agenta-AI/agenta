import {useCallback} from "react"

import clsx from "clsx"

import AddButton from "@/components/NewPlayground/assets/AddButton"
import {componentLogger} from "@/components/NewPlayground/assets/utilities/componentLogger"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import GenerationCompletionRow from "../GenerationCompletionRow"
import {getMetadataLazy} from "@/components/NewPlayground/state"

import type {GenerationCompletionProps} from "./types"
import type {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"
import type {
    ArrayMetadata,
    ObjectMetadata,
} from "@/components/NewPlayground/assets/utilities/genericTransformer/types"

const GenerationCompletion = ({className, variantId, rowClassName}: GenerationCompletionProps) => {
    const {inputRowIds, mutate, viewType} = usePlayground({
        variantId,
        stateSelector: useCallback((state: PlaygroundStateData) => {
            const inputRows = state.generationData.value || []
            return {
                inputRowIds: inputRows.map((inputRow) => inputRow.__id),
            }
        }, []),
    })

    const addNewInputRow = useCallback(() => {
        mutate((clonedState) => {
            if (!clonedState) return clonedState

            const _metadata = getMetadataLazy<ArrayMetadata>(clonedState?.generationData.__metadata)

            const itemMetadata = _metadata?.itemMetadata as ObjectMetadata

            if (!itemMetadata) return clonedState

            const inputKeys = Object.keys(itemMetadata.properties)
            const newRow = createInputRow(inputKeys, itemMetadata)

            clonedState.generationData.value.push(newRow)

            return clonedState
        })
    }, [mutate])

    componentLogger("GenerationTestView", inputRowIds)

    return (
        <div className={clsx(["flex flex-col", {"gap-4": viewType === "single"}], className)}>
            {inputRowIds.map((inputRowId) => {
                return (
                    <GenerationCompletionRow
                        key={inputRowId}
                        variantId={variantId}
                        rowId={inputRowId}
                        className={rowClassName}
                    />
                )
            })}

            <div
                className={clsx([
                    "flex items-center gap-2 mx-2",
                    {"mt-2": viewType === "comparison"},
                ])}
            >
                <AddButton size="small" label="Input" onClick={addNewInputRow} />
            </div>
        </div>
    )
}

export default GenerationCompletion
