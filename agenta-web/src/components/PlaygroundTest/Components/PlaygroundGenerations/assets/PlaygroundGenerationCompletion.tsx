import AddButton from "@/components/PlaygroundTest/assets/AddButton"
import {componentLogger} from "@/components/PlaygroundTest/assets/utilities/componentLogger"
import {EnhancedVariant} from "@/components/PlaygroundTest/assets/utilities/transformer/types"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import {createInputRow} from "@/components/PlaygroundTest/hooks/usePlayground/assets/inputHelpers"
import {useCallback} from "react"
import GenerationCompletionRow from "./GenerationCompletionRow"
import {Button} from "antd"

const PlaygroundGenerationCompletion = ({variantId}: any) => {
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
                    <GenerationCompletionRow
                        key={inputRowId}
                        variantId={variantId}
                        rowId={inputRowId}
                    />
                )
            })}

            <div className="flex items-center gap-2">
                <AddButton size="small" label="Input" onClick={addNewInputRow} />
                <Button size="small">Add all to test set</Button>
            </div>
        </div>
    )
}

export default PlaygroundGenerationCompletion
