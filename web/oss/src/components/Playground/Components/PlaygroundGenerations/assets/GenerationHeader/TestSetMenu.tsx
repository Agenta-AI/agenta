import {useMemo} from "react"

import {CaretDownIcon, DatabaseIcon, MagicWandIcon, PlusIcon} from "@phosphor-icons/react"
import {Button, Dropdown, MenuProps, Tooltip} from "antd"

import TestsetDrawerButton from "../../../Drawers/TestsetDrawer"
import LoadTestsetButton from "../../../Modals/LoadTestsetModal/assets/LoadTestsetButton"

interface TestSetMenuProps {
    variantId: string
    resultHashes: any[]
    isRunning: boolean
}

const TestSetMenu = ({variantId, resultHashes, isRunning}: TestSetMenuProps) => {
    const hasResults = useMemo(() => resultHashes?.filter(Boolean)?.length > 0, [resultHashes])

    const items: MenuProps["items"] = [
        {
            key: "load",
            label: (
                <LoadTestsetButton label="Load from testset" variantId={variantId}>
                    <div className="flex items-center gap-2 w-full">
                        <DatabaseIcon size={16} />
                        Load from testset
                    </div>
                </LoadTestsetButton>
            ),
        },
        {
            key: "add",
            label: (
                <Tooltip
                    title={
                        !hasResults
                            ? "Run a generation first to add results to test set"
                            : undefined
                    }
                >
                    <div className="w-full">
                        <TestsetDrawerButton
                            label="Add to testset"
                            resultHashes={resultHashes}
                            disabled={isRunning || !hasResults}
                        >
                            <div className="flex items-center gap-2 w-full">
                                <PlusIcon size={16} />
                                Add to testset
                            </div>
                        </TestsetDrawerButton>
                    </div>
                </Tooltip>
            ),
            disabled: !hasResults || isRunning,
            onClick: (e) => {
                if (!hasResults || isRunning) {
                    e.domEvent.stopPropagation()
                    e.domEvent.preventDefault()
                }
            },
        },
        {
            key: "generate",
            disabled: true,
            label: (
                <Tooltip title="Coming soon">
                    <div className="flex items-center gap-2 w-full text-gray-400 cursor-not-allowed">
                        <MagicWandIcon size={16} />
                        Generate testset
                    </div>
                </Tooltip>
            ),
        },
    ]

    return (
        <Dropdown menu={{items}} trigger={["click"]}>
            <Button size="small" className="flex items-center gap-2">
                <DatabaseIcon size={14} />
                Testset
                <CaretDownIcon className="text-[10px]" />
            </Button>
        </Dropdown>
    )
}

export default TestSetMenu
