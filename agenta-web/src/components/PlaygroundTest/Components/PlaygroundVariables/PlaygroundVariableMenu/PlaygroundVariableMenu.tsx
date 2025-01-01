import {useState} from "react"
import {DotsThreeVertical, MinusCircle, ArrowsOut, Copy, Database} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
import {PlaygroundVariableMenuProps} from "./types"
import clsx from "clsx"
import PlaygroundGenerationFocusDrawer from "../../PlaygroundGenerationFocusDrawer"

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

            <Dropdown
                trigger={["click"]}
                menu={{
                    items: [
                        {
                            key: "duplicate",
                            label: "Duplicate",
                            icon: <Copy size={14} />,
                            onClick: (e) => {
                                e.domEvent.stopPropagation()
                            },
                        },
                        {
                            key: "test-set",
                            label: "Add to test set",
                            icon: <Database size={14} />,
                            onClick: (e) => {
                                e.domEvent.stopPropagation()
                            },
                        },
                    ],
                }}
            >
                <Button icon={<DotsThreeVertical size={14} />} type="text" />
            </Dropdown>

            <PlaygroundGenerationFocusDrawer
                open={isFocusMoodOpen}
                onClose={() => setIsFocusMoodOpen(false)}
                type="completion"
            />
        </div>
    )
}

export default PlaygroundVariableMenu
