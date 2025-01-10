import {useCallback} from "react"

import GenerationRowView from "../GenerationRowView"

import type {GenerationTestViewProps} from "./types"
import {EnhancedVariant} from "@/components/PlaygroundTest/assets/utilities/transformer/types"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import {createInputRow} from "@/components/PlaygroundTest/hooks/usePlayground/assets/inputHelpers"
import AddButton from "@/components/PlaygroundTest/assets/AddButton"
import {componentLogger} from "@/components/PlaygroundTest/assets/utilities/componentLogger"

const GenerationTestView = ({variantId, ...props}: GenerationTestViewProps) => {
    const {inputRowIds, mutateVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: useCallback((variant: EnhancedVariant) => {
            const inputRows = variant.inputs?.value || []
            return {
                inputRowIds: (inputRows || []).map((inputRow) => inputRow.__id),
            }
        }, []),
    })

    const addNewInputRow = useCallback(() => {
        mutateVariant?.((draft) => {
            // Get current input schema from existing inputs
            const itemMetadata = draft.inputs.__metadata.itemMetadata
            const inputKeys = Object.keys(itemMetadata.properties)

            // Create new row with same schema as existing rows
            const newRow = createInputRow(inputKeys, itemMetadata)

            // Add to existing rows
            draft.inputs.value.push(newRow)

            return draft
        })
    }, [mutateVariant])

    componentLogger("GenerationTestView", variantId, inputRowIds)

    return (
        <div className="flex flex-col gap-4">
            {inputRowIds.map((inputRowId) => {
                return (
                    <GenerationRowView key={inputRowId} variantId={variantId} rowId={inputRowId} />
                )
            })}
            <AddButton label="Input" onClick={addNewInputRow} />
        </div>
    )
}

export default GenerationTestView
