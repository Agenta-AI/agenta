import {
    memo,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react"

import {Table} from "antd"
import type {TableProps} from "antd/es/table"
import clsx from "clsx"
import {useSetAtom} from "jotai"

import {
    deleteColumnViewportVisibilityAtom,
    setColumnUserVisibilityAtom,
    setColumnViewportVisibilityAtom,
} from "../atoms/columnVisibility"
import {type VisibilityRegistrationHandler} from "../components/ColumnVisibilityHeader"
import {ColumnVisibilityFlagProvider} from "../context/ColumnVisibilityFlagContext"
import VirtualTableScrollContainerContext from "../context/VirtualTableScrollContainerContext"
import useColumnVisibility from "../hooks/useColumnVisibility"
import useColumnVisibilityControlsBuilder from "../hooks/useColumnVisibilityControls"
import useContainerResize from "../hooks/useContainerResize"
import useExpandableRows from "../hooks/useExpandableRows"
import useHeaderViewportVisibility from "../hooks/useHeaderViewportVisibility"
import useInfiniteScroll from "../hooks/useInfiniteScroll"
import useScrollContainer from "../hooks/useScrollContainer"
import useSmartResizableColumns from "../hooks/useSmartResizableColumns"
import useTableKeyboardShortcuts from "../hooks/useTableKeyboardShortcuts"
import useTableRowSelection from "../hooks/useTableRowSelection"
import ColumnVisibilityProvider from "../providers/ColumnVisibilityProvider"
import type {InfiniteVirtualTableProps} from "../types"
import {
    buildColumnDescendantMap,
    collectFixedColumnKeys,
    mergeHandlers,
    shallowEqual,
} from "../utils/columnUtils"

const scopeUsageCounts = new Map<string, number>()

type InfiniteVirtualTableInnerProps<RecordType extends object> = Omit<
    InfiniteVirtualTableProps<RecordType>,
    "useIsolatedStore" | "store"
>

const InfiniteVirtualTableInnerBase = <RecordType extends object>({
    columns,
    dataSource,
    loadMore,
    rowKey,
    active = true,
    scrollThreshold = 300,
    containerClassName,
    tableClassName,
    tableProps,
    rowSelection,
    resizableColumns,
    columnVisibility,
    onColumnToggle,
    scopeId = null,
    beforeTable,
    bodyHeight = null,
    onHeaderHeightChange,
    keyboardShortcuts,
    expandable,
    tableRef,
}: InfiniteVirtualTableInnerProps<RecordType>) => {
    const generatedScopeId = useId()
    const resolvedScopeId = useMemo(
        () => scopeId ?? `ivt-${generatedScopeId}`,
        [generatedScopeId, scopeId],
    )
    const containerRef = useRef<HTMLDivElement | null>(null)
    const visibilityRootRef = useRef<HTMLDivElement | null>(null)
    const columnDomRefs = useRef<
        Map<string, {cols: HTMLTableColElement[]; headers: HTMLTableCellElement[]}>
    >(new Map())
    const containerSize = useContainerResize(containerRef)
    const [tableHeaderHeight, setTableHeaderHeight] = useState<number | null>(null)
    const lastScrollConfigRef = useRef<Record<string, any> | null>(null)
    const visibilityStorageKey = columnVisibility?.storageKey
    const visibilityDefaultHiddenKeys = columnVisibility?.defaultHiddenKeys
    const normalizedDefaultHiddenKeys = useMemo(
        () => visibilityDefaultHiddenKeys?.map((key) => String(key)),
        [visibilityDefaultHiddenKeys],
    )
    const handleVisibilityStateChange = columnVisibility?.onStateChange
    const handleVisibilityContextChange = columnVisibility?.onContextChange
    const handleViewportVisibilityChange = columnVisibility?.onViewportVisibilityChange
    const baseTrackingEnabled =
        columnVisibility?.viewportTrackingEnabled === undefined
            ? true
            : columnVisibility.viewportTrackingEnabled

    useEffect(() => {
        if (!onHeaderHeightChange) return
        onHeaderHeightChange(tableHeaderHeight)
    }, [onHeaderHeightChange, tableHeaderHeight])

    // Use extracted hook for infinite scroll handling
    const handleScroll = useInfiniteScroll({loadMore, scrollThreshold})

    const scrollX = containerSize.width
    const scrollY = containerSize.height

    const resizable = typeof resizableColumns === "object" ? resizableColumns : undefined
    const resizableEnabled = Boolean(resizableColumns)

    const columnVisibilityResult = useColumnVisibility(columns, {
        storageKey: visibilityStorageKey,
        defaultHiddenKeys: normalizedDefaultHiddenKeys,
    })
    const {visibleColumns, version} = columnVisibilityResult
    const columnVisibilityControls =
        useColumnVisibilityControlsBuilder<RecordType>(columnVisibilityResult)
    const lastReportedVersionRef = useRef<number | null>(null)

    // Calculate selection column width before using resizable columns hook
    const selectionColumnWidth = rowSelection ? (rowSelection.columnWidth ?? 48) : 0

    const {
        columns: resizableProcessedColumns,
        headerComponents: resizableHeaderComponents,
        getTotalWidth,
        isResizing,
    } = useSmartResizableColumns<RecordType>({
        columns: visibleColumns,
        enabled: resizableEnabled,
        minWidth: resizable?.minWidth,
        scopeId: resolvedScopeId,
        containerWidth: scrollX > 0 ? scrollX : 1200, // fallback to 1200 if no width yet
        selectionColumnWidth,
    })
    const visibilityTrackingEnabled = baseTrackingEnabled && active

    const stickyColumnKeys = useMemo(
        () => collectFixedColumnKeys(resizableProcessedColumns),
        [resizableProcessedColumns],
    )

    const finalColumns = resizableProcessedColumns
    const columnDescendantMap = useMemo(
        () => buildColumnDescendantMap(resizableProcessedColumns),
        [resizableProcessedColumns],
    )
    const internalViewportVisibilityHandler = useSetAtom(setColumnViewportVisibilityAtom)
    const internalViewportVisibilityDeleteHandler = useSetAtom(deleteColumnViewportVisibilityAtom)
    const internalUserVisibilityHandler = useSetAtom(setColumnUserVisibilityAtom)
    const viewportVisibilityHandler =
        handleViewportVisibilityChange ?? internalViewportVisibilityHandler
    const _userVisibilityHandler = onColumnToggle ?? internalUserVisibilityHandler

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

        const registry = new Map<
            string,
            {cols: HTMLTableColElement[]; headers: HTMLTableCellElement[]}
        >()
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
    }, [resizableProcessedColumns])

    const registerHeaderForVisibility = useHeaderViewportVisibility({
        scopeId: resolvedScopeId,
        containerRef: visibilityRootRef,
        onVisibilityChange: viewportVisibilityHandler,
        onColumnUnregister: internalViewportVisibilityDeleteHandler,
        enabled: visibilityTrackingEnabled,
        suspendUpdates: isResizing,
        viewportMargin: columnVisibility?.viewportMargin,
        exitDebounceMs: columnVisibility?.viewportExitDebounceMs,
        excludeKeys: stickyColumnKeys,
        descendantColumnMap: columnDescendantMap,
    })

    const visibilityHandlersRef = useRef(new Map<string, (node: HTMLElement | null) => void>())

    useEffect(() => {
        visibilityHandlersRef.current.clear()
    }, [registerHeaderForVisibility])

    const registerHeaderNode = useCallback(
        (columnKey: string, node: HTMLElement | null) => {
            if (!registerHeaderForVisibility) return
            const cache = visibilityHandlersRef.current
            let handler = cache.get(columnKey)
            if (!handler) {
                handler = registerHeaderForVisibility(columnKey)
                cache.set(columnKey, handler)
            }
            handler(node)
        },
        [registerHeaderForVisibility],
    )

    const visibilityRegistration = registerHeaderForVisibility ? registerHeaderNode : null
    const lastNotifiedContextRef = useRef<{
        version: number
        register: VisibilityRegistrationHandler | null
    } | null>(null)

    useEffect(() => {
        if (handleVisibilityStateChange && columnVisibilityControls) {
            if (lastReportedVersionRef.current !== version) {
                lastReportedVersionRef.current = version
                handleVisibilityStateChange(columnVisibilityControls)
            }
        }
        if (handleVisibilityContextChange && columnVisibilityControls) {
            const previous = lastNotifiedContextRef.current
            const nextRegister = visibilityRegistration ?? null
            const shouldNotify =
                !previous || previous.version !== version || previous.register !== nextRegister
            if (shouldNotify) {
                lastNotifiedContextRef.current = {
                    version,
                    register: nextRegister,
                }
                handleVisibilityContextChange({
                    controls: columnVisibilityControls,
                    registerHeader: nextRegister,
                    version,
                })
            }
        }
    }, [
        columnVisibilityControls,
        handleVisibilityContextChange,
        handleVisibilityStateChange,
        visibilityRegistration,
        version,
    ])

    // Ensure the Ant Design selection column (checkbox column) keeps the configured
    // width, even when using resizable columns and fixed headers. AntD renders the
    // selection column via col.ant-table-selection-col and th.ant-table-selection-column,
    // which are not part of our normal column tree, so we adjust them directly.
    useLayoutEffect(() => {
        if (!rowSelection) return
        if (!selectionColumnWidth || !Number.isFinite(selectionColumnWidth)) return

        const container = containerRef.current
        if (!container) return

        const widthPx = `${selectionColumnWidth}px`

        const tables = container.querySelectorAll<HTMLTableElement>(".ant-table table")
        tables.forEach((table) => {
            const selectionCol = table.querySelector<HTMLTableColElement>(
                "colgroup col.ant-table-selection-col",
            )
            if (selectionCol) {
                selectionCol.style.width = widthPx
                selectionCol.style.minWidth = widthPx
                selectionCol.style.maxWidth = widthPx
            }
        })

        const headerCells = container.querySelectorAll<HTMLTableCellElement>(
            ".ant-table-thead th.ant-table-selection-column",
        )
        headerCells.forEach((cell) => {
            cell.style.width = widthPx
            cell.style.minWidth = widthPx
            cell.style.maxWidth = widthPx
        })
    }, [rowSelection, selectionColumnWidth, resizableProcessedColumns])

    const computedTotalWidth = useMemo(
        () => getTotalWidth(finalColumns),
        [finalColumns, getTotalWidth],
    )
    const computedScrollX = computedTotalWidth + selectionColumnWidth

    const resolvedTableProps = useMemo<TableProps<RecordType>>(
        () => tableProps ?? ({} as TableProps<RecordType>),
        [tableProps],
    )

    useLayoutEffect(() => {
        const container = containerRef.current
        if (!container) {
            setTableHeaderHeight(null)
            return
        }
        const headerEl =
            container.querySelector<HTMLElement>(".ant-table-thead") ??
            container.querySelector<HTMLElement>("table thead")
        if (!headerEl) {
            setTableHeaderHeight(null)
            return
        }
        let frameId: number | null = null
        const updateHeight = () => {
            if (frameId !== null) {
                cancelAnimationFrame(frameId)
            }
            frameId = requestAnimationFrame(() => {
                frameId = null
                const nextHeight = headerEl.getBoundingClientRect().height
                setTableHeaderHeight((prev) => {
                    if (prev === nextHeight) return prev
                    return Number.isFinite(nextHeight) ? nextHeight : prev
                })
            })
        }
        const observer = new ResizeObserver(() => updateHeight())
        observer.observe(headerEl)
        updateHeight()
        return () => {
            if (frameId !== null) {
                cancelAnimationFrame(frameId)
            }
            observer.disconnect()
        }
    }, [])

    const scrollConfig = useMemo(() => {
        if (typeof bodyHeight === "number" && Number.isFinite(bodyHeight)) {
            const resolvedScroll = resolvedTableProps.scroll
            const resolvedX =
                resolvedScroll && typeof resolvedScroll.x !== "undefined"
                    ? resolvedScroll.x
                    : scrollX > 0
                      ? scrollX
                      : undefined
            return {x: resolvedX, y: bodyHeight}
        }
        const headerHeight =
            (typeof tableHeaderHeight === "number" && Number.isFinite(tableHeaderHeight)
                ? tableHeaderHeight
                : (containerRef.current?.querySelector(".ant-table-thead") as HTMLElement | null)
                      ?.offsetHeight) ?? null

        const computedY = Math.max((scrollY ?? 0) - (headerHeight ?? 0), 0)
        const resolvedScroll = resolvedTableProps.scroll
        const requestedY =
            resolvedScroll && typeof resolvedScroll.y === "number" ? resolvedScroll.y : undefined
        const fallbackY = requestedY ?? computedY
        let resolvedY =
            typeof fallbackY === "number" && Number.isFinite(fallbackY) ? fallbackY : undefined
        const resolvedX = (() => {
            const rawX = resolvedScroll?.x
            if (typeof rawX === "number" || typeof rawX === "string") {
                return rawX
            }
            const computed =
                Number.isFinite(computedScrollX) && computedScrollX > 0 ? computedScrollX : 0
            const container = scrollX > 0 ? scrollX : 0

            // Always use the larger of computed or container width
            // The sum constraint is enforced in computeSmartWidths,
            // so computed should always >= container
            const maxWidth = Math.max(computed, container)
            return maxWidth > 0 ? maxWidth : undefined
        })()

        if (resolvedY === undefined || resolvedY <= 0) {
            const measured = scrollY ?? 0
            resolvedY = measured > 0 ? Math.max(measured - (headerHeight ?? 0), 0) : 360
        }

        if (resolvedY <= 0) {
            resolvedY = 360
        }

        const {
            x: _ignoredX,
            y: _ignoredY,
            ...restScroll
        } = (resolvedScroll ?? {}) as Record<string, any>
        const nextConfig = {
            ...restScroll,
            x: resolvedX,
            y: resolvedY,
        }
        const previous = lastScrollConfigRef.current
        if (shallowEqual(previous, nextConfig)) {
            return previous!
        }
        lastScrollConfigRef.current = nextConfig
        return nextConfig
    }, [
        bodyHeight,
        scrollX,
        scrollY,
        resolvedTableProps.scroll,
        shallowEqual,
        computedScrollX,
        tableHeaderHeight,
    ])

    // Memoize dependencies object to prevent unnecessary useEffect runs in useScrollContainer
    // Without memoization, a new object is created every render, causing infinite loops during scroll
    const scrollContainerDeps = useMemo(
        () => ({
            scrollX: scrollConfig.x,
            scrollY: scrollConfig.y,
            className: resolvedTableProps.className,
        }),
        [scrollConfig.x, scrollConfig.y, resolvedTableProps.className],
    )

    const {scrollContainer, visibilityRoot} = useScrollContainer(containerRef, scrollContainerDeps)

    // Sync visibilityRootRef with visibilityRoot from hook
    useEffect(() => {
        visibilityRootRef.current = visibilityRoot ?? containerRef.current
    }, [visibilityRoot])

    const mergedComponents = useMemo(() => {
        if (!resizableHeaderComponents) {
            return resolvedTableProps.components
        }
        const existingHeader = resolvedTableProps.components?.header ?? {}
        return {
            ...resolvedTableProps.components,
            header: {
                ...existingHeader,
                ...resizableHeaderComponents,
            },
        }
    }, [resolvedTableProps.components, resizableHeaderComponents])

    const finalTableProps = useMemo<TableProps<RecordType>>(
        () => ({
            ...resolvedTableProps,
            components: mergedComponents,
        }),
        [resolvedTableProps, mergedComponents],
    )

    const {getRowProps: getShortcutRowProps} = useTableKeyboardShortcuts<RecordType>({
        containerRef,
        dataSource,
        rowKey,
        rowSelection,
        keyboardShortcuts,
        active,
    })

    const mergedOnRow = useCallback(
        (record: RecordType, index: number) => {
            const baseOnRow = finalTableProps.onRow
            const baseProps = baseOnRow ? baseOnRow(record, index) : {}
            const shortcutProps = getShortcutRowProps
                ? (getShortcutRowProps(record, index) ?? {})
                : {}
            if (!shortcutProps || Object.keys(shortcutProps).length === 0) {
                return baseProps
            }
            return {
                ...baseProps,
                ...shortcutProps,
                className: clsx(baseProps?.className, shortcutProps?.className),
                onMouseEnter: mergeHandlers(baseProps?.onMouseEnter, shortcutProps?.onMouseEnter),
            }
        },
        [finalTableProps.onRow, getShortcutRowProps],
    )

    const tablePropsWithShortcuts = useMemo<TableProps<RecordType>>(() => {
        if (!getShortcutRowProps) {
            return finalTableProps
        }
        return {
            ...finalTableProps,
            onRow: mergedOnRow,
        }
    }, [finalTableProps, getShortcutRowProps, mergedOnRow])

    const tableRowSelection = useTableRowSelection(rowSelection)

    // Expandable rows support
    const expandableConfig = useExpandableRows({
        config: expandable,
        rowKey,
    })

    // Build expandable prop for Ant Design Table
    const tableExpandable = useMemo(() => {
        if (!expandable) return undefined
        return {
            expandedRowKeys: expandableConfig.expandedRowKeys,
            onExpand: expandableConfig.onExpand,
            expandedRowRender: expandableConfig.expandedRowRender,
            expandIcon: expandableConfig.expandIcon,
            rowExpandable: expandableConfig.rowExpandable,
            columnWidth: expandableConfig.expandColumnWidth,
            fixed: expandableConfig.expandFixed,
        }
    }, [expandable, expandableConfig])

    const columnVisibilityVersion = version

    useEffect(() => {
        const key = resolvedScopeId
        if (!key) return undefined
        const nextCount = (scopeUsageCounts.get(key) ?? 0) + 1
        scopeUsageCounts.set(key, nextCount)
        if (nextCount > 1 && process.env.NODE_ENV !== "production") {
            console.warn(
                `[InfiniteVirtualTable] Duplicate scopeId "${key}" detected. Column visibility state will be shared across tables.`,
            )
        }
        return () => {
            const current = scopeUsageCounts.get(key) ?? 0
            if (current <= 1) {
                scopeUsageCounts.delete(key)
            } else {
                scopeUsageCounts.set(key, current - 1)
            }
        }
    }, [resolvedScopeId])

    return (
        <VirtualTableScrollContainerContext.Provider value={scrollContainer}>
            <ColumnVisibilityProvider<RecordType>
                controls={columnVisibilityControls}
                registerHeader={visibilityRegistration}
                version={columnVisibilityVersion}
                renderMenuContent={columnVisibility?.renderMenuContent}
                renderMenuTrigger={columnVisibility?.renderMenuTrigger}
                scopeId={resolvedScopeId}
            >
                <ColumnVisibilityFlagProvider scopeId={resolvedScopeId}>
                    {beforeTable}
                    <div ref={containerRef} className={clsx(containerClassName)}>
                        <Table<RecordType>
                            ref={tableRef as React.Ref<any>}
                            className={tableClassName}
                            columns={finalColumns}
                            dataSource={dataSource}
                            rowKey={rowKey}
                            pagination={false}
                            onScroll={handleScroll}
                            rowSelection={tableRowSelection}
                            expandable={tableExpandable}
                            {...tablePropsWithShortcuts}
                            scroll={{
                                x: scrollConfig.x,
                                y: scrollConfig.y,
                            }}
                            virtual
                        />
                    </div>
                </ColumnVisibilityFlagProvider>
            </ColumnVisibilityProvider>
        </VirtualTableScrollContainerContext.Provider>
    )
}

// Memoize the inner component to create a render boundary
// This prevents re-renders when parent re-renders with referentially equal props
const InfiniteVirtualTableInner = memo(
    InfiniteVirtualTableInnerBase,
) as typeof InfiniteVirtualTableInnerBase

export default InfiniteVirtualTableInner
