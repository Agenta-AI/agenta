import {
    type Key,
    memo,
    type MouseEvent,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react"

import type {TableProps} from "antd/es/table"
import {useSetAtom} from "jotai"

import {cn} from "../../utils/styles"
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
import useScrollContainer from "../hooks/useScrollContainer"
import useSmartResizableColumns from "../hooks/useSmartResizableColumns"
import useTableKeyboardShortcuts from "../hooks/useTableKeyboardShortcuts"
import {shouldIgnoreRowClick} from "../hooks/useTableManager"
import {useTypeChipColumns} from "../hooks/useTypeChipColumns"
import {useTypeChipFeature} from "../hooks/useTypeChipFeature"
import useVirtualTableRowSelection from "../hooks/useVirtualTableRowSelection"
import ColumnVisibilityProvider from "../providers/ColumnVisibilityProvider"
import {ANTD_SELECTOR, AVT, stampTableDom} from "../tableDom"
import type {InfiniteVirtualTableProps} from "../types"
import {
    buildColumnDescendantMap,
    collectFixedColumnKeys,
    mergeHandlers,
    shallowEqual,
} from "../utils/columnUtils"

import {VirtualTable} from "./VirtualTable"

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
    typeChips,
    disableInteractiveClickGuard = false,
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
    const lastScrollConfigRef = useRef<Exclude<TableProps<RecordType>["scroll"], undefined> | null>(
        null,
    )
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

    const typeChipFeature = useTypeChipFeature(typeChips)
    const typeChipColumns = useTypeChipColumns(
        resizableProcessedColumns,
        dataSource,
        typeChipFeature.typeChips,
    )

    // Workaround for an AntD virtual-table layout quirk: after fast horizontal
    // scrolling, header <th> widths can drift away from body cell widths until
    // *something* forces a column-level re-render. We bump `layoutNudge` after
    // horizontal scroll settles to produce fresh column object references in
    // `finalColumns`, which is enough to make AntD rebuild its layout state.
    const [layoutNudge, setLayoutNudge] = useState(0)

    const finalColumns = useMemo(
        () => (layoutNudge > 0 ? typeChipColumns.map((col) => ({...col})) : typeChipColumns),
        [typeChipColumns, layoutNudge],
    )
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
            container.querySelectorAll<HTMLTableCellElement>(ANTD_SELECTOR.headerCellWithKey),
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
                ANTD_SELECTOR.selectionCol,
            )
            if (selectionCol) {
                selectionCol.style.width = widthPx
                selectionCol.style.minWidth = widthPx
                selectionCol.style.maxWidth = widthPx
            }
        })

        const headerCells = container.querySelectorAll<HTMLTableCellElement>(
            ANTD_SELECTOR.headerSelectionCell,
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

    // Row heights are measured after mount, so this is only the virtualizer's first guess.
    const ENGINE_ROW_HEIGHT = 48

    // antd accepts a string key or a function; VirtualTable takes a function.
    const resolveRowKey = useCallback(
        (record: RecordType, index: number) =>
            typeof rowKey === "function"
                ? rowKey(record, index)
                : ((record as Record<string, Key>)[rowKey as string] ?? index),
        [rowKey],
    )

    const virtualSelection = useVirtualTableRowSelection<RecordType>({
        rowSelection,
        dataSource,
        rowKey: resolveRowKey,
    })

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
            container.querySelector<HTMLElement>(ANTD_SELECTOR.header) ??
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
                : (containerRef.current?.querySelector(ANTD_SELECTOR.header) as HTMLElement | null)
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

        const resolvedScrollObject =
            typeof resolvedScroll === "object" && resolvedScroll !== null ? resolvedScroll : {}
        const {x: _ignoredX, y: _ignoredY, ...restScroll} = resolvedScrollObject
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
            scrollX:
                typeof scrollConfig.x === "string" || typeof scrollConfig.x === "number"
                    ? scrollConfig.x
                    : undefined,
            scrollY: typeof scrollConfig.y === "number" ? scrollConfig.y : undefined,
            className: resolvedTableProps.className,
        }),
        [scrollConfig.x, scrollConfig.y, resolvedTableProps.className],
    )

    const {scrollContainer, visibilityRoot} = useScrollContainer(containerRef, scrollContainerDeps)

    // Sync visibilityRootRef with visibilityRoot from hook
    useEffect(() => {
        visibilityRootRef.current = visibilityRoot ?? containerRef.current
    }, [visibilityRoot])

    // Bump layoutNudge after horizontal scroll settles. We only react to
    // changes in scrollLeft so vertical scrolling (the common case) doesn't
    // trigger an extra re-render on every pause.
    useEffect(() => {
        if (!scrollContainer) return
        let timer: ReturnType<typeof setTimeout> | null = null
        let lastScrollLeft = scrollContainer.scrollLeft

        const onScroll = () => {
            if (scrollContainer.scrollLeft === lastScrollLeft) return
            lastScrollLeft = scrollContainer.scrollLeft
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
                setLayoutNudge((prev) => prev + 1)
                timer = null
            }, 150)
        }

        scrollContainer.addEventListener("scroll", onScroll, {passive: true})
        return () => {
            scrollContainer.removeEventListener("scroll", onScroll)
            if (timer) clearTimeout(timer)
        }
    }, [scrollContainer])

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

    const selectOnRowClick = rowSelection?.selectOnRowClick ?? false

    const handleSelectionRowClick = useCallback(
        (record: RecordType, index?: number) => {
            if (!selectOnRowClick || !rowSelection?.onChange) return

            const checkboxProps = rowSelection.getCheckboxProps?.(record)
            if (checkboxProps?.disabled) return

            const resolvedKey = (() => {
                if (typeof rowKey === "function") return rowKey(record, index ?? 0)
                if (typeof rowKey === "string")
                    return (record as Record<string, unknown>)[rowKey] as Key
                return ((record as Record<string, unknown>).key as Key) ?? index ?? 0
            })()

            const key = resolvedKey as Key
            const isSelected = rowSelection.selectedRowKeys.includes(key)

            if (rowSelection.type === "radio") {
                rowSelection.onChange(isSelected ? [] : [key], isSelected ? [] : [record])
            } else {
                const nextKeys = isSelected
                    ? rowSelection.selectedRowKeys.filter((k) => k !== key)
                    : [...rowSelection.selectedRowKeys, key]
                const nextRows = isSelected
                    ? (dataSource ?? []).filter((r) =>
                          nextKeys.includes(
                              typeof rowKey === "function"
                                  ? rowKey(r, 0)
                                  : typeof rowKey === "string"
                                    ? ((r as Record<string, unknown>)[rowKey] as Key)
                                    : (((r as Record<string, unknown>).key as Key) ?? 0),
                          ),
                      )
                    : [
                          ...(dataSource ?? []).filter((r) => {
                              const rk =
                                  typeof rowKey === "function"
                                      ? rowKey(r, 0)
                                      : typeof rowKey === "string"
                                        ? ((r as Record<string, unknown>)[rowKey] as Key)
                                        : (((r as Record<string, unknown>).key as Key) ?? 0)
                              return rowSelection.selectedRowKeys.includes(rk)
                          }),
                          record,
                      ]
                rowSelection.onChange(nextKeys as Key[], nextRows)
            }
        },
        [selectOnRowClick, rowSelection, rowKey, dataSource],
    )

    const mergedOnRow = useCallback(
        (record: RecordType, index?: number) => {
            const baseOnRow = finalTableProps.onRow
            const baseProps = baseOnRow ? baseOnRow(record, index) : {}
            const shortcutProps =
                getShortcutRowProps && index !== undefined
                    ? (getShortcutRowProps(record, index) ?? {})
                    : {}

            const selectionProps = selectOnRowClick
                ? {
                      onClick: () => handleSelectionRowClick(record, index),
                      className: "cursor-pointer",
                  }
                : {}

            const rawOnClick = mergeHandlers(baseProps?.onClick, selectionProps?.onClick)
            const onClick =
                !disableInteractiveClickGuard && rawOnClick
                    ? (event: MouseEvent<HTMLElement>) => {
                          if (shouldIgnoreRowClick(event)) return
                          rawOnClick(event as MouseEvent<HTMLTableRowElement>)
                      }
                    : rawOnClick

            return {
                ...baseProps,
                ...shortcutProps,
                ...selectionProps,
                className: cn(
                    baseProps?.className,
                    shortcutProps?.className,
                    selectionProps?.className,
                ),
                onMouseEnter: mergeHandlers(baseProps?.onMouseEnter, shortcutProps?.onMouseEnter),
                onClick,
            }
        },
        [
            finalTableProps.onRow,
            getShortcutRowProps,
            selectOnRowClick,
            handleSelectionRowClick,
            disableInteractiveClickGuard,
        ],
    )

    const tablePropsWithShortcuts = useMemo<TableProps<RecordType>>(() => {
        const needsMerge =
            getShortcutRowProps ||
            selectOnRowClick ||
            (Boolean(finalTableProps.onRow) && !disableInteractiveClickGuard)
        if (!needsMerge) {
            return finalTableProps
        }
        return {
            ...finalTableProps,
            onRow: mergedOnRow,
        }
    }, [
        finalTableProps,
        getShortcutRowProps,
        selectOnRowClick,
        mergedOnRow,
        disableInteractiveClickGuard,
    ])

    // Expandable rows support
    const expandableConfig = useExpandableRows({
        config: expandable,
        rowKey,
    })

    // Build expandable prop for Ant Design Table
    // antd tracks expansion as a key list; TanStack as a record.
    const virtualExpandedState = useMemo(() => {
        const keys = expandableConfig.expandedRowKeys ?? []
        return Object.fromEntries(keys.map((key: Key) => [String(key), true]))
    }, [expandableConfig.expandedRowKeys])

    const columnVisibilityVersion = version

    // Stable class hooks for app code, so a consumer's selector does not depend on antd's DOM.
    // The structural nodes exist for the table's lifetime; rows and cells get theirs from
    // rowClassName and the column adapter, because virtualization recycles them.
    useEffect(() => {
        stampTableDom(containerRef.current)
    }, [dataSource])

    const rowClassName = useMemo<TableProps<RecordType>["rowClassName"]>(() => {
        const inherited = tablePropsWithShortcuts.rowClassName
        if (!inherited) return AVT.row
        if (typeof inherited !== "function") return cn(inherited, AVT.row)
        return (record, index, indent) => cn(inherited(record, index, indent), AVT.row)
    }, [tablePropsWithShortcuts.rowClassName])

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
                    {/* An empty table has nothing to scroll to, but rc-table still hands its
                        placeholder body the numeric `scroll.x` — which on a bordered table is a
                        pixel wider than the body's own viewport, so a horizontal scrollbar sits
                        under every empty table. Suppress it while there are no rows. */}
                    <div
                        ref={containerRef}
                        className={cn(
                            AVT.root,
                            "[&_.ant-table-empty_.ant-table-body]:!overflow-x-hidden",
                            containerClassName,
                        )}
                    >
                        <VirtualTable<RecordType>
                            className={cn(tableClassName, finalTableProps.className)}
                            columns={finalColumns}
                            dataSource={dataSource}
                            rowKey={resolveRowKey}
                            rowHeight={ENGINE_ROW_HEIGHT}
                            height={typeof scrollConfig.y === "number" ? scrollConfig.y : undefined}
                            loadMore={loadMore}
                            scrollThreshold={scrollThreshold}
                            rowClassName={
                                // antd's RowClassName takes (record, index, indent).
                                typeof rowClassName === "function"
                                    ? (record, index) => rowClassName(record, index, 0)
                                    : undefined
                            }
                            loading={Boolean(finalTableProps.loading)}
                            style={finalTableProps.style}
                            emptyText={
                                // antd allows a render function here; VirtualTable takes a node.
                                typeof finalTableProps.locale?.emptyText === "function"
                                    ? finalTableProps.locale.emptyText()
                                    : finalTableProps.locale?.emptyText
                            }
                            size={
                                // antd's SizeType is wider than Table accepts. Pass only the
                                // real values through; undefined must stay undefined so
                                // VirtualTable's default density applies.
                                finalTableProps.size === "small" ||
                                finalTableProps.size === "middle" ||
                                finalTableProps.size === "large"
                                    ? finalTableProps.size
                                    : undefined
                            }
                            bordered={finalTableProps.bordered}
                            enableColumnResizing={resizableEnabled}
                            tableRef={tableRef}
                            // Row clicks (and the interactive-click guard) are composed the
                            // same way for both engines; without this, rows are inert here.
                            onRow={(record, index) => mergedOnRow(record, index) ?? {}}
                            // antd's table stretches columns to fill the container; without
                            // this the tanstack engine would leave the surplus unused.
                            autoLayout
                            {...(virtualSelection ?? {})}
                            {...(expandable
                                ? {
                                      expanded: virtualExpandedState,
                                      renderExpandedRow: (record) =>
                                          expandableConfig.expandedRowRender?.(record),
                                  }
                                : {})}
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
