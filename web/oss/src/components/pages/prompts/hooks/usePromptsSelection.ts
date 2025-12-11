import {Key, useEffect, useMemo, useState} from "react"

import {InfiniteVirtualTableRowSelection} from "@/oss/components/InfiniteVirtualTable"

import {FolderTreeItem} from "../assets/utils"
import {PromptsTableRow} from "../types"

interface UsePromptsSelectionParams {
    flattenedTableRows: PromptsTableRow[]
    getRowKey: (item: FolderTreeItem) => string
}

export const usePromptsSelection = ({flattenedTableRows, getRowKey}: UsePromptsSelectionParams) => {
    const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
    const [selectedRow, setSelectedRow] = useState<FolderTreeItem | null>(null)

    const rowSelection = useMemo<InfiniteVirtualTableRowSelection<PromptsTableRow>>(
        () => ({
            type: "radio",
            selectedRowKeys,
            onChange: (keys: Key[], selectedRows: PromptsTableRow[]) => {
                setSelectedRowKeys(keys as string[])
                setSelectedRow(selectedRows[0] ?? null)
            },
        }),
        [selectedRowKeys],
    )

    useEffect(() => {
        if (!selectedRowKeys.length) {
            setSelectedRow(null)
            return
        }

        const currentKey = selectedRowKeys[0]
        const currentRow = flattenedTableRows.find((item) => getRowKey(item) === currentKey) ?? null

        if (!currentRow) {
            setSelectedRowKeys([])
            setSelectedRow(null)
            return
        }

        setSelectedRow(currentRow)
    }, [flattenedTableRows, getRowKey, selectedRowKeys])

    return {selectedRowKeys, setSelectedRowKeys, selectedRow, setSelectedRow, rowSelection}
}
