import {useCallback, useEffect, useMemo, useState} from "react"

import type {InfiniteVirtualTableRowSelection} from "@agenta/ui/table"
import type {Key} from "antd/es/table/interface"

import type {AppWorkflowRow} from "@/oss/components/pages/app-management/store"

export const useAgentsSelection = (rows: AppWorkflowRow[]) => {
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
    const [selectedRows, setSelectedRows] = useState<AppWorkflowRow[]>([])

    const rowSelection = useMemo<InfiniteVirtualTableRowSelection<AppWorkflowRow>>(
        () => ({
            type: "checkbox",
            selectedRowKeys,
            onChange: (keys: Key[], nextRows: AppWorkflowRow[]) => {
                setSelectedRowKeys(keys.map(String))
                setSelectedRows(nextRows)
            },
            columnWidth: 48,
        }),
        [selectedRowKeys],
    )

    useEffect(() => {
        if (!selectedRowKeys.length) {
            setSelectedRows([])
            return
        }

        const rowsByKey = new Map(rows.map((row) => [row.key, row]))
        const nextRows = selectedRowKeys.flatMap((key) => {
            const row = rowsByKey.get(key)
            return row ? [row] : []
        })
        const nextKeys = nextRows.map((row) => row.key)

        if (nextKeys.length !== selectedRowKeys.length) {
            setSelectedRowKeys(nextKeys)
        }
        setSelectedRows(nextRows)
    }, [rows, selectedRowKeys])

    const clearSelection = useCallback(() => {
        setSelectedRowKeys([])
        setSelectedRows([])
    }, [])

    return {selectedRows, rowSelection, clearSelection}
}
