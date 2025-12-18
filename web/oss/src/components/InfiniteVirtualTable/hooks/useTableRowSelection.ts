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
            renderCell,
            onCell: customOnCell,
        } = rowSelection

        return {
            type,
            columnWidth: columnWidth ?? 48,
            selectedRowKeys,
            fixed,
            onCell: (record: RecordType, index?: number) => {
                const baseProps = {
                    align: "center" as const,
                    className: "flex flex-col items-center justify-center",
                }
                if (customOnCell) {
                    const customProps = customOnCell(record, index)
                    return {
                        ...baseProps,
                        ...customProps,
                        className: `${baseProps.className} ${customProps.className || ""}`.trim(),
                    }
                }
                return baseProps
            },
            onChange,
            getCheckboxProps,
            renderCell,
        }
    }, [rowSelection])
}

export default useTableRowSelection
