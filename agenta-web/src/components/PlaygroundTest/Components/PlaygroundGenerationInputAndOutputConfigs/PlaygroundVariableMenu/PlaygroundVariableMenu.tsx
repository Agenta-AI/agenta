import {useCallback, useState} from "react"
import {MinusCircle, ArrowsOut} from "@phosphor-icons/react"
import {Button} from "antd"
import {PlaygroundVariableMenuProps} from "./types"
import clsx from "clsx"
import PlaygroundGenerationFocusDrawer from "../../Drawers/PlaygroundGenerationFocusDrawer"
import PlaygroundGenerationVariableMenu from "../../Menus/PlaygroundGenerationVariableMenu"
import usePlayground from "@/components/PlaygroundTest/hooks/usePlayground"

const PlaygroundVariableMenu: React.FC<PlaygroundVariableMenuProps> = ({
    rowId,
    variantId,
    className,
}) => {
    const [isFocusMoodOpen, setIsFocusMoodOpen] = useState(false)
    const {mutateVariant} = usePlayground({
        variantId,
        hookId: "PlaygroundVariableMenu",
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

            <PlaygroundGenerationFocusDrawer
                open={isFocusMoodOpen}
                onClose={() => setIsFocusMoodOpen(false)}
                type="completion"
            />
        </div>
    )
}

export default PlaygroundVariableMenu
