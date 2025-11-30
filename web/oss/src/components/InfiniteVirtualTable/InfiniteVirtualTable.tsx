import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react"
import type {Key, ReactNode} from "react"

import {useQueryClient} from "@tanstack/react-query"
import {Table} from "antd"
import type {ColumnsType, TableProps} from "antd/es/table"
import clsx from "clsx"
import {Provider, useSetAtom} from "jotai"
import {useHydrateAtoms} from "jotai/react/utils"
import {createStore} from "jotai/vanilla"
import type {Store} from "jotai/vanilla/store"
import {queryClientAtom} from "jotai-tanstack-query"

import {
    setColumnUserVisibilityAtom,
    setColumnViewportVisibilityAtom,
} from "./atoms/columnVisibility"
import {type VisibilityRegistrationHandler} from "./components/ColumnVisibilityHeader"
import {useColumnVisibilityControls as useColumnVisibilityControlsFromContext} from "./context/ColumnVisibilityContext"
import {ColumnVisibilityFlagProvider} from "./context/ColumnVisibilityFlagContext"
import useColumnVisibility from "./hooks/useColumnVisibility"
import useHeaderViewportVisibility from "./hooks/useHeaderViewportVisibility"
import useResizableColumns from "./hooks/useResizableColumns"
import useTableKeyboardShortcuts from "./hooks/useTableKeyboardShortcuts"
import ColumnVisibilityProvider from "./providers/ColumnVisibilityProvider"
import type {
    ColumnVisibilityConfig,
    ColumnVisibilityState,
    InfiniteVirtualTableProps,
    InfiniteVirtualTableRowSelection,
    ResizableColumnsConfig,
} from "./types"

const VirtualTableScrollContainerContext = createContext<HTMLDivElement | null>(null)

export const useVirtualTableScrollContainer = () => useContext(VirtualTableScrollContainerContext)

export const useColumnVisibilityControls = <RecordType extends object>() =>
    useColumnVisibilityControlsFromContext<RecordType>()

const scopeUsageCounts = new Map<string, number>()

const collectFixedColumnKeys = <RecordType extends object>(columns: ColumnsType<RecordType>) => {
    const keys = new Set<string>()
    const visit = (cols: ColumnsType<RecordType>) => {
        cols.forEach((column) => {
            const typedColumn = column as any
            if (!typedColumn) return
            const columnKey = typedColumn.key
            const isFixed = Boolean(typedColumn.fixed)
            if (isFixed && columnKey !== undefined && columnKey !== null) {
                keys.add(String(columnKey))
            }
            if (typedColumn.children && typedColumn.children.length) {
                visit(typedColumn.children as ColumnsType<RecordType>)
            }
        })
    }
    visit(columns)
    return Array.from(keys)
}

const toColumnKey = (key: Key | undefined): string | null =>
    key === undefined || key === null ? null : String(key)

const buildColumnDescendantMap = <RecordType extends object>(columns: ColumnsType<RecordType>) => {
    const map = new Map<string, string[]>()
    const gatherDescendants = (column: ColumnsType<RecordType>[number]): string[] => {
        const typedColumn = column as any
        if (!typedColumn) return []
        const key = toColumnKey(typedColumn.key)
        const childColumns = Array.isArray(typedColumn.children)
            ? (typedColumn.children as ColumnsType<RecordType>)
            : null
        if (!childColumns || childColumns.length === 0) {
            return key ? [key] : []
        }
        const descendantLeaves = childColumns.flatMap((child) => gatherDescendants(child))
        if (key && descendantLeaves.length) {
            map.set(key, Array.from(new Set(descendantLeaves)))
        }
        return descendantLeaves.length ? descendantLeaves : key ? [key] : []
    }
    columns.forEach((column) => gatherDescendants(column))
    return map
}

const mergeHandlers = <
    T extends (...args: any[]) => void | undefined,
    U extends (...args: any[]) => void | undefined,
>(
    first?: T,
    second?: U,
): ((...args: Parameters<T>) => void) | ((...args: Parameters<U>) => void) | undefined => {
    if (!first && !second) {
        return undefined
    }
    if (!first) {
        return second as any
    }
    if (!second) {
        return first as any
    }
    return ((...args: any[]) => {
        first(...(args as Parameters<T>))
        second(...(args as Parameters<U>))
    }) as any
}

type InfiniteVirtualTableInnerProps<RecordType extends object> = Omit<
    InfiniteVirtualTableProps<RecordType>,
    "useIsolatedStore" | "store"
>

const InfiniteVirtualTableInner = <RecordType extends object>({
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
}: InfiniteVirtualTableInnerProps<RecordType>) => {
    const generatedScopeId = useId()
    const resolvedScopeId = useMemo(
        () => scopeId ?? `ivt-${generatedScopeId}`,
        [generatedScopeId, scopeId],
    )
    const containerRef = useRef<HTMLDivElement | null>(null)
    const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null)
    const [visibilityRoot, setVisibilityRoot] = useState<HTMLDivElement | null>(null)
    const visibilityRootRef = useRef<HTMLDivElement | null>(null)
    const columnDomRefs = useRef<
        Map<string, {cols: HTMLTableColElement[]; headers: HTMLTableCellElement[]}>
    >(new Map())
    const [containerSize, setContainerSize] = useState<{width: number; height: number}>({
        width: 0,
        height: 0,
    })
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
        const element = containerRef.current
        if (!element) return

        let frameId: number | null = null
        const observer = new ResizeObserver((entries) => {
            const entry = entries[0]
            if (!entry) return
            const contentBoxSize = Array.isArray(entry.contentBoxSize)
                ? entry.contentBoxSize[0]
                : entry.contentBoxSize
            const nextWidth =
                contentBoxSize?.inlineSize ?? entry.contentRect?.width ?? element.clientWidth
            const nextHeight =
                contentBoxSize?.blockSize ?? entry.contentRect?.height ?? element.clientHeight

            const update = () => {
                setContainerSize((prev) => {
                    if (prev.width === nextWidth && prev.height === nextHeight) {
                        return prev
                    }
                    return {width: nextWidth, height: nextHeight}
                })
            }

            if (frameId !== null) {
                cancelAnimationFrame(frameId)
            }
            frameId = requestAnimationFrame(update)
        })

        observer.observe(element)
        return () => {
            if (frameId !== null) {
                cancelAnimationFrame(frameId)
            }
            observer.disconnect()
        }
    }, [])

    useEffect(() => {
        if (!onHeaderHeightChange) return
        onHeaderHeightChange(tableHeaderHeight)
    }, [onHeaderHeightChange, tableHeaderHeight])

    // Use a ref to track pending RAF to avoid scheduling multiple frames
    const scrollRafRef = useRef<number | null>(null)
    const lastScrollTargetRef = useRef<HTMLDivElement | null>(null)

    // Track vertical scrolling to suspend column visibility updates
    const [isVerticalScrolling, setIsVerticalScrolling] = useState(false)
    const verticalScrollTimeoutRef = useRef<number | null>(null)
    const lastScrollTopRef = useRef<number>(0)

    const handleScroll = useCallback(
        (event: React.UIEvent<HTMLDivElement>) => {
            const container = event.currentTarget
            const currentScrollTop = container.scrollTop

            // Detect vertical scroll by comparing scrollTop
            const isVerticalScroll = Math.abs(currentScrollTop - lastScrollTopRef.current) > 1
            lastScrollTopRef.current = currentScrollTop

            // If scrolling vertically, suspend column visibility updates
            if (isVerticalScroll) {
                setIsVerticalScrolling(true)

                // Clear existing timeout
                if (verticalScrollTimeoutRef.current !== null) {
                    window.clearTimeout(verticalScrollTimeoutRef.current)
                }

                // Resume updates after scroll stops (150ms debounce)
                verticalScrollTimeoutRef.current = window.setTimeout(() => {
                    setIsVerticalScrolling(false)
                    verticalScrollTimeoutRef.current = null
                }, 150)
            }

            // Store the scroll target for RAF callback
            lastScrollTargetRef.current = container

            // Skip if we already have a pending RAF
            if (scrollRafRef.current !== null) {
                return
            }

            // Defer layout reads to next animation frame to avoid forced reflow during scroll
            scrollRafRef.current = requestAnimationFrame(() => {
                scrollRafRef.current = null
                const target = lastScrollTargetRef.current
                if (!target) return

                const distanceToBottom =
                    target.scrollHeight - target.scrollTop - target.clientHeight

                if (distanceToBottom < scrollThreshold) {
                    loadMore()
                }
            })
        },
        [loadMore, scrollThreshold],
    )

    // Cleanup RAF and timeout on unmount
    useEffect(() => {
        return () => {
            if (scrollRafRef.current !== null) {
                cancelAnimationFrame(scrollRafRef.current)
            }
            if (verticalScrollTimeoutRef.current !== null) {
                window.clearTimeout(verticalScrollTimeoutRef.current)
            }
        }
    }, [])

    const shallowEqual = useCallback((a: Record<string, any> | null, b: Record<string, any>) => {
        if (a === b) return true
        if (!a || !b) return false
        const keysA = Object.keys(a)
        const keysB = Object.keys(b)
        if (keysA.length !== keysB.length) return false
        for (const key of keysA) {
            if (a[key] !== b[key]) return false
        }
        return true
    }, [])

    const scrollX = containerSize.width
    const scrollY = containerSize.height

    const resizable = typeof resizableColumns === "object" ? resizableColumns : undefined
    const resizableEnabled = Boolean(resizableColumns)

    const {
        visibleColumns,
        leafKeys,
        allKeys,
        hiddenKeys,
        isHidden,
        showColumn,
        hideColumn,
        toggleColumn,
        toggleTree,
        reset,
        columnTree,
        setHiddenKeys,
        version,
    } = useColumnVisibility(columns, {
        storageKey: visibilityStorageKey,
        defaultHiddenKeys: normalizedDefaultHiddenKeys,
    })

    const normalizedIsHidden = useCallback((key: React.Key) => isHidden(String(key)), [isHidden])
    const normalizedShowColumn = useCallback(
        (key: React.Key) => showColumn(String(key)),
        [showColumn],
    )
    const normalizedHideColumn = useCallback(
        (key: React.Key) => hideColumn(String(key)),
        [hideColumn],
    )
    const normalizedToggleColumn = useCallback(
        (key: React.Key) => toggleColumn(String(key)),
        [toggleColumn],
    )
    const normalizedToggleTree = useCallback(
        (key: React.Key) => toggleTree(String(key)),
        [toggleTree],
    )
    const normalizedSetHiddenKeys = useCallback(
        (keys: React.Key[]) => setHiddenKeys(keys.map((key) => String(key))),
        [setHiddenKeys],
    )

    const columnVisibilityControls = useMemo<ColumnVisibilityState<RecordType> | null>(
        () => ({
            columnTree,
            leafKeys,
            allKeys,
            hiddenKeys,
            isHidden: normalizedIsHidden,
            showColumn: normalizedShowColumn,
            hideColumn: normalizedHideColumn,
            toggleColumn: normalizedToggleColumn,
            toggleTree: normalizedToggleTree,
            reset,
            setHiddenKeys: normalizedSetHiddenKeys,
            visibleColumns,
            version,
        }),
        [
            columnTree,
            leafKeys,
            allKeys,
            hiddenKeys,
            normalizedIsHidden,
            normalizedShowColumn,
            normalizedHideColumn,
            normalizedToggleColumn,
            normalizedToggleTree,
            reset,
            normalizedSetHiddenKeys,
            visibleColumns,
            version,
        ],
    )
    const lastReportedVersionRef = useRef<number | null>(null)

    const applyLiveColumnWidth = useCallback(
        ({
            columnKey,
            width,
            minWidth: columnMinWidth,
        }: {
            columnKey: string
            width: number
            minWidth: number
        }) => {
            const targets = columnDomRefs.current.get(columnKey)
            if (!targets) return
            const clamped = Math.max(width, columnMinWidth)
            const widthPx = `${clamped}px`
            targets.cols.forEach((col) => {
                col.style.width = widthPx
                col.style.minWidth = widthPx
            })
            targets.headers.forEach((th) => {
                th.style.width = widthPx
                th.style.minWidth = widthPx
                th.style.maxWidth = widthPx
            })
        },
        [],
    )

    const {
        columns: resizableProcessedColumns,
        headerComponents: resizableHeaderComponents,
        getTotalWidth,
        isResizing,
    } = useResizableColumns<RecordType>({
        columns: visibleColumns,
        enabled: resizableEnabled,
        minWidth: resizable?.minWidth,
        onLiveResize: applyLiveColumnWidth,
        scopeId: resolvedScopeId,
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
    const internalUserVisibilityHandler = useSetAtom(setColumnUserVisibilityAtom)
    const viewportVisibilityHandler =
        handleViewportVisibilityChange ?? internalViewportVisibilityHandler
    const _userVisibilityHandler = onColumnToggle ?? internalUserVisibilityHandler

    useEffect(() => {
        visibilityRootRef.current = visibilityRoot ?? containerRef.current
    }, [visibilityRoot])

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
        enabled: visibilityTrackingEnabled,
        suspendUpdates: isResizing || isVerticalScrolling,
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

    const selectionColumnWidth = rowSelection ? (rowSelection.columnWidth ?? 48) : 0
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
        const updateHeight = () => {
            const nextHeight = headerEl.getBoundingClientRect().height
            setTableHeaderHeight((prev) => {
                if (prev === nextHeight) return prev
                return Number.isFinite(nextHeight) ? nextHeight : prev
            })
        }
        const observer = new ResizeObserver(() => updateHeight())
        observer.observe(headerEl)
        updateHeight()
        return () => observer.disconnect()
    }, [columns, dataSource, resolvedTableProps.components])

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
            if (Number.isFinite(computedScrollX) && computedScrollX > 0) {
                return computedScrollX
            }
            return scrollX > 0 ? scrollX : undefined
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

    useEffect(() => {
        const containerElement = containerRef.current
        if (!containerElement) {
            if (scrollContainer) {
                setScrollContainer(null)
            }
            setVisibilityRoot(null)
            return
        }

        const tableBody = containerElement.querySelector<HTMLDivElement>(".ant-table-body") ?? null

        const isScrollable = (element: HTMLDivElement | null) => {
            if (!element) return false
            const style = window.getComputedStyle(element)
            const overflowValues = [style.overflow, style.overflowX, style.overflowY]
            return overflowValues.some((value) => ["auto", "scroll", "overlay"].includes(value))
        }

        const preferredContainer = isScrollable(tableBody) ? tableBody : null
        const nextScrollContainer = preferredContainer ?? containerElement

        if (nextScrollContainer !== scrollContainer) {
            setScrollContainer(nextScrollContainer)
        }

        const headerContainer =
            containerElement.querySelector<HTMLDivElement>(".ant-table-container") ??
            containerElement
        setVisibilityRoot((prev) => (prev === headerContainer ? prev : headerContainer))
    }, [scrollConfig.x, scrollConfig.y, resolvedTableProps.className])
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

    const tableRowSelection = useMemo<TableProps<RecordType>["rowSelection"] | undefined>(() => {
        if (!rowSelection) return undefined
        const {
            selectedRowKeys,
            onChange,
            getCheckboxProps,
            columnWidth,
            type = "checkbox",
        } = rowSelection
        return {
            type,
            columnWidth: columnWidth ?? 48,
            selectedRowKeys,
            onCell: () => {
                return {
                    align: "center",
                    className: "flex flex-col items-center justify-center",
                }
            },
            onChange,
            getCheckboxProps,
        }
    }, [rowSelection])

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

    console.log("InfiniteVirtualTableInner")
    return (
        <VirtualTableScrollContainerContext.Provider value={scrollContainer}>
            <ColumnVisibilityProvider<RecordType>
                controls={columnVisibilityControls}
                registerHeader={visibilityRegistration}
                version={columnVisibilityVersion}
                renderMenuContent={columnVisibility?.renderMenuContent}
                scopeId={resolvedScopeId}
            >
                <ColumnVisibilityFlagProvider scopeId={resolvedScopeId}>
                    {beforeTable}
                    <div ref={containerRef} className={clsx(containerClassName)}>
                        <Table<RecordType>
                            className={tableClassName}
                            columns={finalColumns}
                            dataSource={dataSource}
                            rowKey={rowKey}
                            pagination={false}
                            onScroll={handleScroll}
                            rowSelection={tableRowSelection}
                            {...tablePropsWithShortcuts}
                            scroll={{
                                x: scrollConfig.x,
                                y: scrollConfig.y,
                            }}
                            virtual={true}
                        />
                    </div>
                </ColumnVisibilityFlagProvider>
            </ColumnVisibilityProvider>
        </VirtualTableScrollContainerContext.Provider>
    )
}

function InfiniteVirtualTable<RecordType extends object>(
    props: InfiniteVirtualTableProps<RecordType>,
) {
    const {useIsolatedStore = false, store, ...rest} = props
    const queryClient = useQueryClient()
    const managedStoreRef = useRef<Store | null>(store ?? null)

    useEffect(() => {
        if (store) {
            managedStoreRef.current = store
        }
    }, [store])

    if (!store && useIsolatedStore && !managedStoreRef.current) {
        managedStoreRef.current = createStore()
    }

    const activeStore = managedStoreRef.current
    const content = <InfiniteVirtualTableInner {...rest} />

    if (!activeStore) {
        return content
    }

    console.log("InfiniteVirtualTable")

    return (
        <Provider store={activeStore}>
            <InfiniteVirtualTableStoreHydrator queryClient={queryClient}>
                {content}
            </InfiniteVirtualTableStoreHydrator>
        </Provider>
    )
}

const InfiniteVirtualTableStoreHydrator = ({
    queryClient,
    children,
}: {
    queryClient: ReturnType<typeof useQueryClient>
    children: ReactNode
}) => {
    useHydrateAtoms([[queryClientAtom, queryClient]])
    return <>{children}</>
}

export const InfiniteVirtualTableStoreProvider = ({
    store,
    children,
}: {
    store?: Store
    children: ReactNode
}) => {
    const queryClient = useQueryClient()
    const storeRef = useRef<Store>(store ?? createStore())
    return (
        <Provider store={storeRef.current}>
            <InfiniteVirtualTableStoreHydrator queryClient={queryClient}>
                {children}
            </InfiniteVirtualTableStoreHydrator>
        </Provider>
    )
}

export default InfiniteVirtualTable

export type {
    InfiniteVirtualTableRowSelection,
    ResizableColumnsConfig,
    ColumnVisibilityConfig,
    ColumnVisibilityState,
}
