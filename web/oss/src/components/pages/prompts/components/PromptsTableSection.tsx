import {Dropdown, Input, Space, Button, MenuProps} from "antd"
import {ColumnsType, TableProps} from "antd/es/table"

import {FolderIcon, PlusIcon, SquaresFourIcon, TrashIcon} from "@phosphor-icons/react"

import {
    InfiniteDatasetStore,
    InfiniteVirtualTableFeatureShell,
    InfiniteVirtualTableRowSelection,
    TableFeaturePagination,
    TableScopeConfig,
} from "@/oss/components/InfiniteVirtualTable"

import {SetupWorkflowIcon} from "./SetupWorkflowIcon"
import {PromptsTableRow} from "../types"

interface PromptsTableSectionProps {
    columns: ColumnsType<PromptsTableRow>
    datasetStore: InfiniteDatasetStore<PromptsTableRow, PromptsTableRow, {projectId: string | null}>
    tableRows: PromptsTableRow[]
    rowKeyExtractor: (row: PromptsTableRow) => string
    tableScope: TableScopeConfig
    tablePagination: TableFeaturePagination<PromptsTableRow>
    rowSelection: InfiniteVirtualTableRowSelection<PromptsTableRow>
    expandable?: TableProps<PromptsTableRow>["expandable"]
    tableProps?: TableProps<PromptsTableRow>
    searchTerm: string
    onSearchChange: (value: string) => void
    selectedRow: PromptsTableRow | null
    onDeleteSelected: () => void
    onOpenNewPrompt: () => void
    onOpenNewFolder: () => void
    onSetupWorkflow: () => void
}

export const PromptsTableSection = ({
    columns,
    tableRows,
    rowKeyExtractor,
    tableScope,
    tablePagination,
    rowSelection,
    expandable,
    tableProps,
    searchTerm,
    onSearchChange,
    selectedRow,
    onDeleteSelected,
    onOpenNewPrompt,
    onOpenNewFolder,
    onSetupWorkflow,
    datasetStore,
}: PromptsTableSectionProps) => {
    const menuItems: MenuProps["items"] = [
        {
            key: "new_prompt",
            icon: <SquaresFourIcon size={16} />,
            label: "New prompt",
            onClick: ({domEvent}) => {
                domEvent.stopPropagation()
                onOpenNewPrompt()
            },
        },
        {
            key: "new_folder",
            icon: <FolderIcon size={16} />,
            label: "New folder",
            onClick: ({domEvent}) => {
                domEvent.stopPropagation()
                onOpenNewFolder()
            },
        },
        {
            type: "divider" as const,
        },
        {
            key: "setup_workflow",
            icon: <SetupWorkflowIcon />,
            label: "Set up workflow",
            onClick: ({domEvent}) => {
                domEvent.stopPropagation()
                onSetupWorkflow()
            },
        },
    ]

    return (
        <div className="flex flex-col gap-2 grow">
            <div className="flex items-center justify-between">
                <Space>
                    <Input.Search
                        placeholder="Search"
                        allowClear
                        className="w-[400px]"
                        value={searchTerm}
                        onChange={(event) => onSearchChange(event.target.value)}
                    />
                </Space>

                <Space>
                    <Button
                        icon={<TrashIcon />}
                        danger
                        disabled={!selectedRow}
                        onClick={onDeleteSelected}
                    >
                        Delete
                    </Button>

                    <Dropdown
                        trigger={["click"]}
                        overlayStyle={{width: 200}}
                        placement="bottomLeft"
                        menu={{items: menuItems}}
                    >
                        <Button icon={<PlusIcon />} type="primary">
                            Create new
                        </Button>
                    </Dropdown>
                </Space>
            </div>

            <InfiniteVirtualTableFeatureShell<PromptsTableRow>
                datasetStore={datasetStore}
                tableScope={tableScope}
                columns={columns}
                rowKey={rowKeyExtractor}
                dataSource={tableRows}
                pagination={tablePagination}
                rowSelection={rowSelection}
                expandable={expandable}
                tableProps={tableProps}
            />
        </div>
    )
}
