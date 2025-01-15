import AddButton from "@/components/NewPlayground/assets/AddButton"
import {componentLogger} from "@/components/NewPlayground/assets/utilities/componentLogger"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import {useCallback} from "react"
import GenerationCompletionRow from "../GenerationCompletionRow"
import {GenerationCompletionProps} from "./types"
import clsx from "clsx"
import {PlaygroundStateData} from "@/components/NewPlayground/hooks/usePlayground/types"

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
        mutate((state) => {
            const clonedState = structuredClone(state)
            if (!clonedState) return state

            const itemMetadata = clonedState?.generationData.__metadata.itemMetadata
            const inputKeys = Object.keys(itemMetadata.properties)
            const newRow = createInputRow(inputKeys, itemMetadata)

            clonedState.generationData.value.push(newRow)

            return clonedState
        })
    }, [mutate])

    componentLogger("GenerationTestView", inputRowIds)

    return (
        <div className={clsx(["flex flex-col", {"gap-4": viewType === "single"}])}>
            {inputRowIds.map((inputRowId) => {
                return (
                    <GenerationCompletionRow
                        key={inputRowId}
                        variantId={variantId}
                        rowId={inputRowId}
                        className={rowClassName || className}
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
