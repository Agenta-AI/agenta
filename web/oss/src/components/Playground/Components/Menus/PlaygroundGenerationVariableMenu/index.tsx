import {useMemo} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {DotsThreeVertical, Copy, Database} from "@phosphor-icons/react"
import {Dropdown, MenuProps} from "antd"

import TestsetDrawerButton from "../../Drawers/TestsetDrawer"

import {PlaygroundGenerationVariableMenuProps} from "./types"

const PlaygroundGenerationVariableMenu: React.FC<PlaygroundGenerationVariableMenuProps> = ({
    duplicateRow,
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
                    duplicateRow()
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
        [duplicateRow, result, resultHash],
    )
    return (
        <Dropdown trigger={["click"]} menu={{items}} {...props}>
            <Button variant="ghost" size="icon-sm">
                {<DotsThreeVertical size={14} />}
            </Button>
        </Dropdown>
    )
}

export default PlaygroundGenerationVariableMenu
