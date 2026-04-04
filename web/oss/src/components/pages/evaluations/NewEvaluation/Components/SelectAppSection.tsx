import {memo, useCallback, useMemo, useState} from "react"

import {InfiniteVirtualTableFeatureShell, useTableManager} from "@agenta/ui/table"
import {Input} from "antd"
import clsx from "clsx"
import {useSetAtom} from "jotai"
import dynamic from "next/dynamic"

import {createAppWorkflowColumns} from "@/oss/components/pages/app-management/components/appWorkflowColumns"
import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"
import {
    appWorkflowPaginatedStore,
    appWorkflowSearchTermAtom,
} from "@/oss/components/pages/app-management/store"

const NoResultsFound = dynamic(
    () => import("@/oss/components/Placeholders/NoResultsFound/NoResultsFound"),
    {ssr: false},
)

const EMPTY_ACTIONS = {
    onOpen: () => {},
    onDelete: () => {},
}

interface SelectAppSectionProps {
    selectedAppId: string
    onSelectApp: (value: string) => void
    disabled?: boolean
    className?: string
}

const SelectAppSection = ({
    selectedAppId,
    onSelectApp,
    disabled,
    className,
}: SelectAppSectionProps) => {
    const [searchTerm, setSearchTerm] = useState("")
    const setStoreSearchTerm = useSetAtom(appWorkflowSearchTermAtom)

    const handleSearch = useCallback(
        (value: string) => {
            setSearchTerm(value)
            setStoreSearchTerm(value)
        },
        [setStoreSearchTerm],
    )

    const table = useTableManager<AppWorkflowRow>({
        datasetStore: appWorkflowPaginatedStore.store as never,
        scopeId: "evaluation-app-selector",
        pageSize: 50,
        searchDeps: [searchTerm],
        rowClassName: "variant-table-row",
    })

    const columns = useMemo(() => createAppWorkflowColumns(EMPTY_ACTIONS), [])

    const onSelectRow = useCallback(
        (selectedRowKeys: React.Key[]) => {
            if (disabled) return
            const selectedId = selectedRowKeys[0] as string | undefined
            if (selectedId) {
                onSelectApp(selectedId)
            }
        },
        [disabled, onSelectApp],
    )

    const rowSelection = useMemo(
        () => ({
            type: "checkbox" as const,
            selectedRowKeys: selectedAppId ? [selectedAppId] : [],
            onChange: (keys: React.Key[]) => onSelectRow(keys),
            getCheckboxProps: () => ({disabled}),
            selectOnRowClick: !disabled,
        }),
        [selectedAppId, onSelectRow, disabled],
    )

    return (
        <div className={clsx(className)}>
            <div className="flex items-start justify-between mb-2 gap-4">
                <Input.Search
                    placeholder="Search"
                    className="w-[300px] [&_input]:!py-[3.1px]"
                    value={searchTerm}
                    onChange={(e) => handleSearch(e.target.value)}
                />
            </div>
            <div className="h-[455px]">
                <InfiniteVirtualTableFeatureShell<AppWorkflowRow>
                    {...table.shellProps}
                    columns={columns}
                    rowSelection={rowSelection}
                    enableExport={false}
                    autoHeight
                    locale={{
                        emptyText: (
                            <NoResultsFound
                                className="!py-10"
                                description={
                                    disabled
                                        ? "Application selection is locked in app scope"
                                        : "No applications available"
                                }
                            />
                        ),
                    }}
                />
            </div>
        </div>
    )
}

export default memo(SelectAppSection)
