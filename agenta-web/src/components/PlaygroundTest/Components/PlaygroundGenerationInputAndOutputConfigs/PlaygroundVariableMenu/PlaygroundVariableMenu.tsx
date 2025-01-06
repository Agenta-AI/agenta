import {useState} from "react"
import {MinusCircle, ArrowsOut} from "@phosphor-icons/react"
import {Button} from "antd"
import {PlaygroundVariableMenuProps} from "./types"
import clsx from "clsx"
import PlaygroundGenerationFocusDrawer from "../../Drawers/PlaygroundGenerationFocusDrawer"
import PlaygroundGenerationVariableMenu from "../../Menus/PlaygroundGenerationVariableMenu"

const PlaygroundVariableMenu: React.FC<PlaygroundVariableMenuProps> = ({className}) => {
    const [isFocusMoodOpen, setIsFocusMoodOpen] = useState(false)

    return (
        <div className={clsx("flex items-center gap-1", className)}>
            <Button
                icon={<ArrowsOut size={14} />}
                type="text"
                onClick={() => setIsFocusMoodOpen(true)}
            />
            <Button icon={<MinusCircle size={14} />} type="text" />

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
