import {useCallback} from "react"

import AddButton from "../../../../assets/AddButton"
import usePlayground from "../../../../hooks/usePlayground"
import {createInputRow} from "../../../../hooks/usePlayground/assets/inputHelpers"

import GenerationRowView from "../GenerationRowView"
import { componentLogger } from "../../../../assets/utilities/componentLogger"

import type {GenerationTestViewProps} from "./types"

const GenerationTestView = ({variantId, ...props}: GenerationTestViewProps) => {
    const {inputRowIds, mutateVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundConfigVariantPrompts",
        variantSelector: (variant) => {
            const inputRows = variant.inputs?.value || []
            return {
                inputRowIds: (inputRows || []).map((inputRow) => inputRow.__id),
            }
        },
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
                return <GenerationRowView key={inputRowId} variantId={variantId} rowId={inputRowId} />
            })}
            <AddButton label="Input" onClick={addNewInputRow} />
        </div>
    )
}

export default GenerationTestView
