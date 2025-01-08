import {useMemo} from "react"
import {DotsThreeVertical, Copy, Database} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"
import {PlaygroundGenerationVariableMenuProps} from "./types"

const PlaygroundGenerationVariableMenu: React.FC<PlaygroundGenerationVariableMenuProps> = ({
    ...props
}) => {
    const items: MenuProps["items"] = useMemo(
        () => [
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
        [],
    )
    return (
        <Dropdown trigger={["click"]} menu={{items}} {...props}>
            <Button icon={<DotsThreeVertical size={14} />} type="text" />
        </Dropdown>
    )
}

export default PlaygroundGenerationVariableMenu
