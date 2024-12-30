import {DotsThreeVertical, MinusCircle, ArrowsOut, Copy, Database} from "@phosphor-icons/react"
import {Button, Dropdown} from "antd"
import {PlaygroundVariableMenuProps} from "./types"

const PlaygroundVariableMenu: React.FC<PlaygroundVariableMenuProps> = () => {
    return (
        <div className="flex items-center gap-1">
            <Button icon={<ArrowsOut size={14} />} type="text" />
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
        </div>
    )
}

export default PlaygroundVariableMenu
