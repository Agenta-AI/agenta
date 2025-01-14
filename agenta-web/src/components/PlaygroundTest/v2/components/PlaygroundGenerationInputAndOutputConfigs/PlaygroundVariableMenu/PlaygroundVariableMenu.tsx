import {useCallback, useState} from "react"
import {MinusCircle, ArrowsOut} from "@phosphor-icons/react"
import {Button} from "antd"
import {GenerationVariableOptionsProps} from "./types"
import clsx from "clsx"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"
import PlaygroundGenerationVariableMenu from "@/components/PlaygroundTest/Components/Menus/PlaygroundGenerationVariableMenu"
import GenerationFocusDrawer from "@/components/PlaygroundTest/Components/Drawers/GenerationFocusDrawer"

const GenerationVariableOptions: React.FC<GenerationVariableOptionsProps> = ({
    rowId,
    variantId,
    className,
}) => {
    const [isFocusMoodOpen, setIsFocusMoodOpen] = useState(false)
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
            <Button
                icon={<ArrowsOut size={14} />}
                type="text"
                onClick={() => setIsFocusMoodOpen(true)}
            />
            <Button icon={<MinusCircle size={14} />} type="text" onClick={deleteInputRow} />

            <PlaygroundGenerationVariableMenu />

            <GenerationFocusDrawer
                open={isFocusMoodOpen}
                onClose={() => setIsFocusMoodOpen(false)}
                type="completion"
                variantId={variantId}
                rowId=""
                inputRows={[]}
                loadNextRow={() => {}}
                loadPrevRow={() => {}}
            />
        </div>
    )
}

export default GenerationVariableOptions
