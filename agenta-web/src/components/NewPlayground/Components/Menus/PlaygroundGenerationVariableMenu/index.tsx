import {useMemo} from "react"
import {DotsThreeVertical, Copy, Database} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"
import {PlaygroundGenerationVariableMenuProps} from "./types"
import TestsetDrawerButton from "../../Drawers/TestsetDrawer"

const PlaygroundGenerationVariableMenu: React.FC<PlaygroundGenerationVariableMenuProps> = ({
    duplicateInputRow,
    result,
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
                    duplicateInputRow()
                },
            },
            {
                key: "test-set",
                label: (
                    <TestsetDrawerButton results={result}>
                        <div>Add to test set</div>
                    </TestsetDrawerButton>
                ),
                icon: <Database size={14} />,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                },
            },
        ],
        [result],
    )
    return (
        <Dropdown trigger={["click"]} menu={{items}} {...props}>
            <Button icon={<DotsThreeVertical size={14} />} type="text" size="small" />
        </Dropdown>
    )
}

export default PlaygroundGenerationVariableMenu
