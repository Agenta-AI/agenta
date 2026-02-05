import {useLayoutEffect, useRef} from "react"

import type {ColumnsType} from "antd/es/table"

interface ColumnDomRefs {
    cols: HTMLTableColElement[]
    headers: HTMLTableCellElement[]
}

/**
 * Hook to track and manage column DOM element references for live resizing
 */
const useColumnDomRefs = <RecordType>(
    containerRef: React.RefObject<HTMLDivElement | null>,
    columns: ColumnsType<RecordType>,
) => {
    const columnDomRefs = useRef<Map<string, ColumnDomRefs>>(new Map())

    useLayoutEffect(() => {
        const container = containerRef.current
        if (!container) {
            columnDomRefs.current = new Map()
            return
        }

        const headerCells = Array.from(
            container.querySelectorAll<HTMLTableCellElement>(
                ".ant-table-thead th[data-column-key]",
            ),
        ).filter((cell) => Number(cell.getAttribute("colspan") ?? "1") === 1)

        if (!headerCells.length) {
            columnDomRefs.current = new Map()
            return
        }

        const keyToIndices = new Map<string, number[]>()
        headerCells.forEach((cell) => {
            const key = cell.dataset.columnKey
            if (!key) return
            const index = cell.cellIndex
            if (index < 0) return
            if (!keyToIndices.has(key)) {
                keyToIndices.set(key, [])
            }
            keyToIndices.get(key)!.push(index)
        })

        const registry = new Map<string, ColumnDomRefs>()
        headerCells.forEach((cell) => {
            const key = cell.dataset.columnKey
            if (!key) return
            if (!registry.has(key)) {
                registry.set(key, {cols: [], headers: []})
            }
            registry.get(key)!.headers.push(cell)
        })

        const tables = container.querySelectorAll<HTMLTableElement>(".ant-table table")
        tables.forEach((table) => {
            const cols = table.querySelectorAll<HTMLTableColElement>("colgroup col")
            keyToIndices.forEach((indices, key) => {
                indices.forEach((idx) => {
                    const col = cols[idx]
                    if (!col) return
                    if (!registry.has(key)) {
                        registry.set(key, {cols: [], headers: []})
                    }
                    registry.get(key)!.cols.push(col)
                })
            })
        })

        columnDomRefs.current = registry
    }, [columns, containerRef])

    return columnDomRefs
}

export default useColumnDomRefs
