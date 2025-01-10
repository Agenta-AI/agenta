import {useMemo} from "react"
import {DotsThreeVertical, Copy, X} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"
import {PlaygroundPromptToolMenuProps} from "./types"

const PlaygroundPromptToolMenu: React.FC<PlaygroundPromptToolMenuProps> = ({...props}) => {
    const items: MenuProps["items"] = useMemo(
        () => [
            {
                key: "copy",
                label: "Copy",
                icon: <Copy size={14} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                },
            },
            {
                key: "remove",
                label: "Remove",
                icon: <X size={14} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                },
            },
        ],
        [],
    )
    return (
        <Dropdown trigger={["click"]} menu={{items}} {...props}>
            <Button icon={<DotsThreeVertical size={14} />} type="text" />
        </Dropdown>
    )
}

export default PlaygroundPromptToolMenu
