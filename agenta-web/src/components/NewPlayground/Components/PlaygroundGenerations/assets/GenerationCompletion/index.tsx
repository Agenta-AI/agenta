import AddButton from "@/components/NewPlayground/assets/AddButton"
import {componentLogger} from "@/components/NewPlayground/assets/utilities/componentLogger"
import {EnhancedVariant} from "@/components/NewPlayground/assets/utilities/transformer/types"
import usePlayground from "@/components/NewPlayground/hooks/usePlayground"
import {createInputRow} from "@/components/NewPlayground/hooks/usePlayground/assets/inputHelpers"
import {useCallback} from "react"
import GenerationCompletionRow from "../GenerationCompletionRow"
import {Button} from "antd"
import {GenerationCompletionProps} from "./types"
import clsx from "clsx"

const GenerationCompletion = ({variantId, className, rowClassName}: GenerationCompletionProps) => {
    const {inputRowIds, mutateVariant, viewType} = usePlayground({
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
                {viewType === "single" && <Button size="small">Add all to test set</Button>}
            </div>
        </div>
    )
}

export default GenerationCompletion
