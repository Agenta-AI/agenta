import {useMemo, useCallback, useRef, type RefObject} from "react"
import {DownOutlined, RightOutlined} from "@ant-design/icons"
import {Table} from "antd"
import {ColumnsType} from "antd/es/table"
import {useLocalStorage, useResizeObserver} from "usehooks-ts"
import clsx from "clsx"

import {EnhancedTableProps, EnhancedColumnType} from "./types"
import {ResizableTitle, SkeletonCell} from "./assets/CustomCells"

const EnhancedTable = <RecordType extends {key?: React.Key; isSkeleton?: boolean}>({
    columns,
    dataSource,
    loading,
    skeletonRowCount = 5,
    addNotAvailableCell = true,
    virtualized = false,
    uniqueKey,
    ...rest
}: EnhancedTableProps<RecordType>) => {
    const [columnWidths, setColumnWidths] = useLocalStorage<Record<string, number>>(
        `${uniqueKey}-tableColumnWidths`,
        {},
    )
    const [collapsed, setCollapsed] = useLocalStorage<Record<string, boolean>>(
        `${uniqueKey}-tableColumnsCollapsed`,
        {},
    )

    // Container ref used to measure available space for optional virtualization
    const containerRef = useRef<HTMLDivElement | null>(null)
    const {height: containerHeight, width: containerWidth} = useResizeObserver({
        // Always pass the ref object; the hook handles `current` being null
        ref: containerRef as RefObject<HTMLElement>,
        box: "border-box",
    })

    // Toggle the collapse state for a column group
    const toggleCollapse = useCallback((key: string) => {
        setCollapsed((prev) => ({...prev, [key]: !prev[key]}))
    }, [])

    // Resize handler for resizable columns
    const handleResize = useCallback(
        (colKey: string) =>
            (_: any, {size}: {size: {width: number}}) => {
                // Enforce minimum width of 50px
                const minWidth = 50
                const newWidth = Math.max(size.width, minWidth)
                setColumnWidths((widths) => ({...widths, [colKey]: newWidth}))
            },
        [],
    )

    // Recursively enhance the provided columns with resizable headers, collapsible
    // groups and custom cell rendering logic
    const applyFeatures = useCallback(
        (cols: EnhancedColumnType<RecordType>[], path: string[] = []): ColumnsType<RecordType> => {
            return cols.map((col, index) => {
                const key = String(col.key ?? col.dataIndex ?? [...path, index].join("-"))

                const isCollapsed = !!col.collapsible && collapsed[key]
                let children = col.children?.filter(Boolean)

                let width = columnWidths[key] ?? Math.max((col.width as number) ?? 160, 80)

                const baseRender = col.render

                // Enhanced cell renderer handling skeleton rows, not available.
                const render = (value: any, record: RecordType, index: number) => {
                    if (record.isSkeleton) {
                        return <SkeletonCell />
                    }
                    const content = baseRender ? baseRender(value, record, index) : value

                    if (addNotAvailableCell && !content) {
                        return <div className="not-available-table-cell" />
                    }

                    return content
                }

                const rawTitle = typeof col.title === "function" ? col.title({}) : col.title

                const titleContent = <span className="whitespace-nowrap">{rawTitle}</span>

                const title = col.collapsible ? (
                    <span
                        className="cursor-pointer flex items-center gap-1 whitespace-nowrap"
                        onClick={(e) => {
                            e.stopPropagation()
                            toggleCollapse(key)
                        }}
                    >
                        {isCollapsed ? <RightOutlined /> : <DownOutlined />}
                        {titleContent}
                    </span>
                ) : (
                    titleContent
                )

                if (children && children.length > 0) {
                    children = applyFeatures(children, [...path, String(index)])
                    return {
                        ...col,
                        key,
                        title,
                        children:
                            col.collapsible && isCollapsed
                                ? []
                                : children.map((child) => ({
                                      ...child,
                                      width,
                                      onHeaderCell: () => ({
                                          ...child.onHeaderCell,
                                          width,
                                          onResize: handleResize(key),
                                      }),
                                  })),
                        width,
                        ellipsis: true,
                        onHeaderCell: () => ({
                            ...col.onHeaderCell,
                            width,
                            onResize: handleResize(key),
                        }),
                        render: (value: any, record: RecordType, index: number) => {
                            if (isCollapsed) return null
                            return render(value, record, index)
                        },
                    }
                }

                if (col.collapsible) {
                    const collapsedLeaf = collapsed[key]
                    return {
                        ...col,
                        key,
                        title,
                        width,
                        ellipsis: true,
                        onHeaderCell: () => ({
                            ...col.onHeaderCell,
                            width,
                            onResize: handleResize(key),
                        }),
                        render: (value: any, record: RecordType, index: number) => {
                            if (collapsedLeaf) return null
                            return render(value, record, index)
                        },
                        onCell: (record: RecordType, rowIndex: number) => {
                            const base = col.onCell?.(record, rowIndex) || {}
                            return {
                                ...base,
                                style: {...base.style, minWidth: 0, width},
                            }
                        },
                    }
                }

                return {
                    ...col,
                    key,
                    title,
                    width,
                    ellipsis: true,
                    onHeaderCell: () => ({
                        ...col.onHeaderCell,
                        width,
                        onResize: handleResize(key),
                    }),
                    onCell: (record: RecordType, rowIndex: number) => {
                        const base = col.onCell?.(record, rowIndex) || {}
                        return {
                            ...base,
                            style: {...base.style, minWidth: 0, width},
                        }
                    },
                    render,
                }
            }) as unknown as ColumnsType<RecordType>
        },
        [collapsed, columnWidths, handleResize, toggleCollapse, addNotAvailableCell],
    )

    const finalColumns = useMemo(() => applyFeatures(columns, []), [columns, applyFeatures])

    // Temporary rows shown while loading
    const skeletonData = useMemo(
        () =>
            Array.from({length: skeletonRowCount}, (_, idx) => ({
                key: `skeleton-${idx}`,
                isSkeleton: true,
            })) as RecordType[],
        [skeletonRowCount],
    )
    const data = useMemo(() => {
        if (loading && (!dataSource || (Array.isArray(dataSource) && dataSource.length === 0))) {
            return skeletonData
        }
        return dataSource
    }, [loading, dataSource, skeletonData])

    const tableLoading = useMemo(() => {
        if (data === skeletonData) return false
        return loading
    }, [loading, data, skeletonData])

    const {virtualizationActive, scroll} = useMemo(() => {
        if (!virtualized) {
            return {
                virtualizationActive: false,
                scroll: rest.scroll,
            }
        }

        // Measure the table header height so we can subtract it from the available space when virtualization is active
        const headerHeight =
            (containerRef.current?.querySelector(".ant-table-thead") as HTMLElement)
                ?.offsetHeight || 0

        // Virtual scrolling only applies when explicitly enabled and we have a measurable container height
        const virtualizationActive = virtualized && containerHeight! > 0

        // When virtualized, set Ant Design's scroll props based on the available container dimensions
        const scroll = virtualizationActive
            ? {
                  y: rest.scroll?.y || containerHeight! - headerHeight,
                  x: rest.scroll?.x || containerWidth,
              }
            : rest.scroll

        return {virtualizationActive, scroll}
    }, [virtualized, containerHeight, containerWidth, rest.scroll])

    const table = (
        <Table
            {...rest}
            dataSource={data}
            columns={finalColumns}
            loading={tableLoading}
            components={{
                ...rest.components,
                header: {
                    cell: ResizableTitle,
                },
            }}
            className={clsx(
                rest.className,
                "enhanced-table",
                "[&_.ant-table-tbody-virtual]:!border-0 [&_.ant-table-tbody-virtual-scrollbar]:!h-0",
            )}
            scroll={scroll}
            sticky={virtualizationActive || rest.sticky}
            virtual={virtualizationActive}
            tableLayout={virtualizationActive ? "fixed" : rest.tableLayout}
            pagination={false}
            bordered
        />
    )

    if (virtualized) {
        return (
            <div ref={containerRef} className="relative w-full flex-1 min-h-0 overflow-hidden">
                {table}
            </div>
        )
    }

    return table
}

export default EnhancedTable
