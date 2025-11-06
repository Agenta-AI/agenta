import {useMemo} from "react"

import {DotsThreeVertical, Copy, Database} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps} from "antd"

import TestsetDrawerButton from "../../Drawers/TestsetDrawer"

import {PlaygroundGenerationVariableMenuProps} from "./types"

const PlaygroundGenerationVariableMenu: React.FC<PlaygroundGenerationVariableMenuProps> = ({
    duplicateInputRow,
    result,
    resultHash,
    ...props
}) => {
    const isResults = useMemo(
        () => (Array.isArray(resultHash) ? resultHash : [resultHash])?.filter(Boolean)?.length,
        [resultHash],
    )

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
                key: "testset",
                label: (
                    <TestsetDrawerButton
                        resultHashes={Array.isArray(resultHash) ? resultHash : [resultHash]}
                    >
                        <div>Add to testset</div>
                    </TestsetDrawerButton>
                ),
                icon: <Database size={14} />,
                disabled: !isResults,
                onClick: (e) => {
                    e.domEvent.stopPropagation()
                },
            },
        ],
        [result, resultHash],
    )
    return (
        <Dropdown trigger={["click"]} menu={{items}} {...props}>
            <Button icon={<DotsThreeVertical size={14} />} type="text" size="small" />
        </Dropdown>
    )
}

export default PlaygroundGenerationVariableMenu
