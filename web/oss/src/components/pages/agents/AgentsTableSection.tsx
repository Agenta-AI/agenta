import {useMemo} from "react"

import {InfiniteVirtualTableFeatureShell} from "@agenta/ui/table"
import type {
    InfiniteVirtualTableRowSelection,
    TableFeaturePagination,
    TableScopeConfig,
} from "@agenta/ui/table"
import {PlusIcon, TrayIcon} from "@phosphor-icons/react"
import {Button, Input, Space} from "antd"
import type {ColumnsType, TableProps} from "antd/es/table"

import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"
import {useDebounceInput} from "@/oss/hooks/useDebounceInput"

interface AgentsTableSectionProps {
    columns: ColumnsType<AppWorkflowRow>
    rows: AppWorkflowRow[]
    tableScope: TableScopeConfig
    pagination: TableFeaturePagination<AppWorkflowRow>
    rowSelection: InfiniteVirtualTableRowSelection<AppWorkflowRow>
    tableProps: TableProps<AppWorkflowRow>
    searchTerm: string
    selectedCount: number
    onSearchChange: (value: string) => void
    onCreate: () => void
    onArchive: () => void
}

export default function AgentsTableSection({
    columns,
    rows,
    tableScope,
    pagination,
    rowSelection,
    tableProps,
    searchTerm,
    selectedCount,
    onSearchChange,
    onCreate,
    onArchive,
}: AgentsTableSectionProps) {
    const [localSearchTerm, setLocalSearchTerm] = useDebounceInput<string>(
        searchTerm,
        onSearchChange,
        300,
        "",
    )

    const filters = useMemo(
        () => (
            <Input.Search
                placeholder="Search"
                allowClear
                className="w-[400px]"
                value={localSearchTerm}
                onChange={(event) => setLocalSearchTerm(event.target.value)}
            />
        ),
        [localSearchTerm, setLocalSearchTerm],
    )

    const primaryActions = useMemo(
        () => (
            <Space>
                <Button
                    type="text"
                    danger={selectedCount > 0}
                    icon={<TrayIcon />}
                    onClick={onArchive}
                >
                    {selectedCount > 0 ? "Archive" : "Archived"}
                </Button>
                <Button type="primary" icon={<PlusIcon />} onClick={onCreate}>
                    Create
                </Button>
            </Space>
        ),
        [onArchive, onCreate, selectedCount],
    )

    return (
        <InfiniteVirtualTableFeatureShell<AppWorkflowRow>
            className="grow min-h-0 [&_.ant-table-cell]:!align-middle [&_.ant-table-container]:!border-b"
            tableScope={tableScope}
            columns={columns}
            rowKey={(record) => record.key}
            dataSource={rows}
            pagination={pagination}
            rowSelection={rowSelection}
            tableProps={tableProps}
            filters={filters}
            primaryActions={primaryActions}
        />
    )
}
