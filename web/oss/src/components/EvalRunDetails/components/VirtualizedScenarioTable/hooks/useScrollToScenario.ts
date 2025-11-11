import {RefObject, useEffect, useMemo, useRef} from "react"

import {useRouter} from "next/router"

import {TableRow} from "../types"

type TableRowWithChildren = TableRow & {
    scenarioId?: string
    children?: TableRowWithChildren[]
}

const useScrollToScenario = ({
    dataSource,
    expandedRowKeys = [],
}: {
    dataSource: TableRowWithChildren[]
    expandedRowKeys?: string[]
}) => {
    const router = useRouter()
    const tableContainerRef = useRef<HTMLDivElement | null>(null)
    const tableInstance = useRef<any>(null)

    const selectedScenarioId = router.query.scrollTo as string

    const flattenedRowKeys = useMemo(() => {
        const keys: string[] = []
        const expandedSet = new Set((expandedRowKeys || []).map((key) => String(key)))

        const traverse = (rows: TableRowWithChildren[] = []) => {
            rows.forEach((row) => {
                const rowKey = (row?.key ?? row?.scenarioId) as string | undefined
                if (!rowKey) return

                keys.push(rowKey)

                const isExpanded = expandedSet.has(rowKey)
                if (!isExpanded) {
                    return
                }

                if (Array.isArray(row.children) && row.children.length > 0) {
                    traverse(row.children)
                }
            })
        }

        traverse(dataSource)

        return keys
    }, [dataSource, expandedRowKeys])

    // Scroll to the specified row when user selects a scenario in auto eval
    useEffect(() => {
        if (!router.isReady) return
        if (!tableInstance.current || !selectedScenarioId) return
        // Get the row index from the flattened dataSource including expanded rows
        const rowIndex = flattenedRowKeys.findIndex((key) => key === selectedScenarioId)
        if (rowIndex === -1) return
        // Use Ant Design's scrollTo method for virtualized tables when available
        if (typeof tableInstance.current?.scrollTo === "function") {
            tableInstance.current.scrollTo({
                index: rowIndex,
                behavior: "smooth",
            })
        }

        const rowElement = tableContainerRef.current?.querySelector(
            `[data-row-key="${selectedScenarioId}"]`,
        ) as HTMLElement | null

        // Fallback to native DOM scrolling when virtualization instance is unavailable
        if (typeof tableInstance.current?.scrollTo !== "function") {
            rowElement?.scrollIntoView({behavior: "smooth", block: "center"})
        }

        // Add highlight effect
        if (rowElement) {
            rowElement.classList.add("highlight-row")
            setTimeout(() => {
                rowElement.classList.remove("highlight-row")
            }, 2000)
        }
    }, [selectedScenarioId, flattenedRowKeys, router.isReady])

    return {tableContainerRef, tableInstance}
}

export default useScrollToScenario
