import {useMemo} from "react"

import type {AppType} from "@agenta/entities/workflow"
import {InfiniteVirtualTableFeatureShell} from "@agenta/ui/table"
import type {
    InfiniteVirtualTableRowSelection,
    TableFeaturePagination,
    TableScopeConfig,
} from "@agenta/ui/table"
import {FolderIcon, PlusIcon, SquaresFourIcon, TrashIcon} from "@phosphor-icons/react"
import {Button, Dropdown, Input, Space} from "antd"
import type {MenuProps} from "antd"
import type {ColumnsType, TableProps} from "antd/es/table"

import {getAppTypeIcon} from "../assets/iconHelpers"
import type {FolderTreeItem} from "../assets/utils"
import type {PromptsTableRow} from "../types"

import SetupWorkflowIcon from "./SetupWorkflowIcon"

interface PromptsTableSectionProps {
    columns: ColumnsType<PromptsTableRow>
    tableRows: PromptsTableRow[]
    tableScope: TableScopeConfig
    tablePagination: TableFeaturePagination<PromptsTableRow>
    rowSelection: InfiniteVirtualTableRowSelection<PromptsTableRow>
    tableProps?: TableProps<PromptsTableRow>
    searchTerm: string
    onSearchChange: (value: string) => void
    onDeleteSelected: () => void
    onOpenNewPrompt: (type: AppType) => void
    onOpenNewFolder: () => void
    onSetupWorkflow: () => void
    selectedRow: FolderTreeItem | null
}

export const PromptsTableSection = ({
    columns,
    tableRows,
    tableScope,
    tablePagination,
    rowSelection,
    tableProps,
    searchTerm,
    onSearchChange,
    selectedRow,
    onDeleteSelected,
    onOpenNewPrompt,
    onOpenNewFolder,
    onSetupWorkflow,
}: PromptsTableSectionProps) => {
    const selectedActionLabel = selectedRow?.type === "folder" ? "Delete" : "Archive"

    const menuItems: MenuProps["items"] = useMemo(
        () => [
            {
                key: "new_prompt",
                icon: <SquaresFourIcon size={16} />,
                label: "New prompt",
                children: [
                    {
                        key: "new_prompt_chat",
                        label: (
                            <span className="inline-flex items-center gap-2">
                                {getAppTypeIcon("chat")}
                                <span>Chat</span>
                            </span>
                        ),
                        onClick: ({
                            domEvent,
                        }: {
                            domEvent: React.MouseEvent | React.KeyboardEvent
                        }) => {
                            domEvent.stopPropagation()
                            onOpenNewPrompt("chat")
                        },
                    },
                    {
                        key: "new_prompt_completion",
                        label: (
                            <span className="inline-flex items-center gap-2">
                                {getAppTypeIcon("completion")}
                                <span>Completion</span>
                            </span>
                        ),
                        onClick: ({
                            domEvent,
                        }: {
                            domEvent: React.MouseEvent | React.KeyboardEvent
                        }) => {
                            domEvent.stopPropagation()
                            onOpenNewPrompt("completion")
                        },
                    },
                ],
            },
            {
                key: "new_folder",
                icon: <FolderIcon size={16} />,
                label: "New folder",
                onClick: ({domEvent}: {domEvent: React.MouseEvent | React.KeyboardEvent}) => {
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
                onClick: ({domEvent}: {domEvent: React.MouseEvent | React.KeyboardEvent}) => {
                    domEvent.stopPropagation()
                    onSetupWorkflow()
                },
            },
        ],
        [onOpenNewPrompt, onOpenNewFolder, onSetupWorkflow],
    )

    const filtersNode = useMemo(
        () => (
            <Input.Search
                placeholder="Search"
                allowClear
                className="w-[400px]"
                value={searchTerm}
                onChange={(event) => onSearchChange(event.target.value)}
            />
        ),
        [searchTerm, onSearchChange],
    )

    const primaryActionsNode = useMemo(
        () => (
            <Space>
                <Button
                    type="text"
                    icon={<TrashIcon />}
                    danger
                    disabled={!selectedRow}
                    onClick={onDeleteSelected}
                >
                    {selectedActionLabel}
                </Button>

                <Dropdown
                    trigger={["click"]}
                    styles={{root: {width: 200}}}
                    placement="bottomLeft"
                    menu={{items: menuItems}}
                >
                    <Button icon={<PlusIcon />} type="primary">
                        Create new
                    </Button>
                </Dropdown>
            </Space>
        ),
        [menuItems, selectedActionLabel, selectedRow, onDeleteSelected],
    )

    return (
        <InfiniteVirtualTableFeatureShell<PromptsTableRow>
            className="grow min-h-0 [&_.ant-table-cell]:!align-middle [&_.ant-table-container]:!border-b"
            tableScope={tableScope}
            columns={columns}
            rowKey={(record) => record.key}
            dataSource={tableRows}
            pagination={tablePagination}
            rowSelection={rowSelection}
            tableProps={tableProps}
            filters={filtersNode}
            primaryActions={primaryActionsNode}
        />
    )
}
