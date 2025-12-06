import {useMemo} from "react"

import type {TableProps} from "antd/es/table"

import type {InfiniteVirtualTableRowSelection} from "../types"

/**
 * Hook to transform InfiniteVirtualTableRowSelection into Ant Design TableProps rowSelection
 */
const useTableRowSelection = <RecordType>(
    rowSelection: InfiniteVirtualTableRowSelection<RecordType> | undefined,
): TableProps<RecordType>["rowSelection"] | undefined => {
    return useMemo(() => {
        if (!rowSelection) return undefined

        const {
            selectedRowKeys,
            onChange,
            getCheckboxProps,
            columnWidth,
            type = "checkbox",
            fixed,
        } = rowSelection

        return {
            type,
            columnWidth: columnWidth ?? 48,
            selectedRowKeys,
            fixed,
            onCell: () => ({
                align: "center" as const,
                className: "flex flex-col items-center justify-center",
            }),
            onChange,
            getCheckboxProps,
        }
    }, [rowSelection])
}

export default useTableRowSelection
