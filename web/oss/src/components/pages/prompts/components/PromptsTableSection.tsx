import {useMemo} from "react"

import type {AppType} from "@agenta/entities/workflow"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {InfiniteVirtualTableFeatureShell} from "@agenta/ui/table"
import type {
    InfiniteVirtualTableRowSelection,
    TableFeaturePagination,
    TableScopeConfig,
} from "@agenta/ui/table"
import {FolderIcon, PlusIcon, SquaresFourIcon, TrashIcon} from "@phosphor-icons/react"
import {Input, Space} from "antd"
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
                <Button disabled={!selectedRow} onClick={onDeleteSelected} variant="destructive">
                    {<TrashIcon />}
                    {selectedActionLabel}
                </Button>

                <DropdownMenu>
                    <DropdownMenuTrigger className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-sm transition-all outline-none select-none hover:bg-primary/80 disabled:pointer-events-none disabled:opacity-50">
                        {<PlusIcon />}
                        Create new
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" sideOffset={4}>
                        <DropdownMenuSub>
                            <DropdownMenuSubTrigger>
                                <SquaresFourIcon size={16} />
                                New prompt
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent>
                                <DropdownMenuItem onClick={() => onOpenNewPrompt("chat")}>
                                    {getAppTypeIcon("chat")}
                                    Chat
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onOpenNewPrompt("completion")}>
                                    {getAppTypeIcon("completion")}
                                    Completion
                                </DropdownMenuItem>
                                <DropdownMenuItem onClick={() => onOpenNewPrompt("agent")}>
                                    {getAppTypeIcon("agent")}
                                    Agent
                                </DropdownMenuItem>
                            </DropdownMenuSubContent>
                        </DropdownMenuSub>
                        <DropdownMenuItem onClick={onOpenNewFolder}>
                            <FolderIcon size={16} />
                            New folder
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onClick={onSetupWorkflow}>
                            <SetupWorkflowIcon />
                            Set up workflow
                        </DropdownMenuItem>
                    </DropdownMenuContent>
                </DropdownMenu>
            </Space>
        ),
        [selectedActionLabel, selectedRow, onDeleteSelected],
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
