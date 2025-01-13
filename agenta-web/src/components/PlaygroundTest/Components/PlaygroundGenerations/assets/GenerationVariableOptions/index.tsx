import {useCallback} from "react"
import {MinusCircle} from "@phosphor-icons/react"
import {Button} from "antd"
import {GenerationVariableOptionsProps} from "./types"
import clsx from "clsx"
import PlaygroundGenerationVariableMenu from "../../../Menus/PlaygroundGenerationVariableMenu"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import GenerationFocusDrawerButton from "../../../Drawers/GenerationFocusDrawer/components/GenerationFocusDrawerButton"

const GenerationVariableOptions: React.FC<GenerationVariableOptionsProps> = ({
    rowId,
    variantId,
    className,
}) => {
    const {mutateVariant} = usePlayground({
        variantId,
        hookId: "GenerationVariableOptions",
    })

    const deleteInputRow = useCallback(() => {
        mutateVariant?.((draft) => {
            // Filter out the row with the specified ID
            draft.inputs.value = draft.inputs.value.filter((row: any) => row.__id !== rowId)

            return draft
        })
    }, [mutateVariant])

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <GenerationFocusDrawerButton rowId={rowId} variantIds={variantId} />
            <Button icon={<MinusCircle size={14} />} type="text" onClick={deleteInputRow} />

            <PlaygroundGenerationVariableMenu />
        </div>
    )
}

export default GenerationVariableOptions
