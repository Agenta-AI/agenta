import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import {Input, Typography} from "antd"
import clsx from "clsx"
import {GenerationTestViewProps} from "./types"
import GenerationRowView from "../GenerationRowView"
import AddButton from "@/components/PlaygroundTest/assets/AddButton"
import {useCallback} from "react"
import {createInputRow} from "@/components/PlaygroundTest/hooks/usePlayground/assets/inputHelpers"

const {TextArea} = Input

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

    console.log(
        "usePlayground[%cComponent%c] - GenerationTestView - RENDER!",
        "color: orange",
        "",
        variantId,
        inputRowIds,
    )

    return (
        <div className="flex flex-col gap-4">
            {inputRowIds.map((inputRowId) => {
                return <GenerationRowView variantId={variantId} rowId={inputRowId} />
            })}
            <AddButton label="Input" onClick={addNewInputRow} />
        </div>
    )
}

export default GenerationTestView
