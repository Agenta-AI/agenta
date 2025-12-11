import {useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {Key, MutableRefObject, RefObject} from "react"

import type {
    InfiniteVirtualTableKeyboardRowShortcuts,
    InfiniteVirtualTableKeyboardSelectionShortcuts,
    InfiniteVirtualTableKeyboardShortcuts,
    InfiniteVirtualTableProps,
    InfiniteVirtualTableRowSelection,
} from "../types"

interface UseTableKeyboardShortcutsParams<RecordType extends object> {
    containerRef: RefObject<HTMLDivElement | null>
    dataSource: RecordType[]
    rowKey: InfiniteVirtualTableProps<RecordType>["rowKey"]
    rowSelection?: InfiniteVirtualTableRowSelection<RecordType>
    keyboardShortcuts?: InfiniteVirtualTableKeyboardShortcuts<RecordType>
    active: boolean
}

interface SelectableEntry<RecordType> {
    key: Key
    record: RecordType
    position: number
}

interface NormalizedSelectionShortcuts {
    enabled: boolean
    navigation: boolean
    range: boolean
    selectAll: boolean
    clear: boolean
}

interface NormalizedRowShortcuts<RecordType> {
    enabled: boolean
    autoHighlightFirstRow: boolean
    highlightOnHover: boolean
    highlightClassName: string
    scrollIntoViewOnChange: boolean
    toggleSelectionWithSpace: boolean
    onHighlightChange?: (payload: {key: Key | null; record: RecordType | null}) => void
    onOpen?: (payload: {key: Key; record: RecordType}) => void
    onDelete?: (payload: {
        key: Key
        record: RecordType
        selected: boolean
        selection: Key[]
    }) => void
    onExport?: (payload: {key: Key | null; record: RecordType | null; selection: Key[]}) => void
}

interface TableShortcutResult<RecordType> {
    getRowProps?: (
        record: RecordType,
        index: number,
    ) => {
        className?: string
        onMouseEnter?: () => void
    }
}

const DEFAULT_HIGHLIGHT_CLASS = "ivt-row--highlighted"

const isInteractiveTarget = (element: HTMLElement | null) => {
    if (!element) return false
    if (element.isContentEditable) return true
    const tag = element.tagName.toLowerCase()
    if (tag === "input" || tag === "textarea" || tag === "select") {
        return true
    }
    const role = element.getAttribute("role")
    if (role && ["textbox", "combobox", "menuitem", "button"].includes(role)) {
        return true
    }
    return Boolean(element.closest("[data-ivt-shortcuts='ignore']"))
}

const normalizeSelectionShortcuts = (
    enabled: boolean,
    selection?: boolean | InfiniteVirtualTableKeyboardSelectionShortcuts,
): NormalizedSelectionShortcuts => {
    const config = selection ?? {}
    const selectionEnabled =
        typeof config === "object" ? (config.enabled ?? true) : config !== false
    return {
        enabled: enabled && selectionEnabled,
        navigation: typeof config === "object" ? (config.navigation ?? true) : config !== false,
        range: typeof config === "object" ? (config.range ?? true) : config !== false,
        selectAll: typeof config === "object" ? (config.selectAll ?? true) : config !== false,
        clear: typeof config === "object" ? (config.clear ?? true) : config !== false,
    }
}

const normalizeRowShortcuts = <RecordType extends object>(
    config?: InfiniteVirtualTableKeyboardRowShortcuts<RecordType>,
): NormalizedRowShortcuts<RecordType> => ({
    enabled: config?.enabled ?? true,
    autoHighlightFirstRow: config?.autoHighlightFirstRow ?? false,
    highlightOnHover: config?.highlightOnHover ?? true,
    highlightClassName: config?.highlightClassName ?? DEFAULT_HIGHLIGHT_CLASS,
    scrollIntoViewOnChange: config?.scrollIntoViewOnChange ?? true,
    toggleSelectionWithSpace: config?.toggleSelectionWithSpace ?? true,
    onHighlightChange: config?.onHighlightChange,
    onOpen: config?.onOpen,
    onDelete: config?.onDelete,
    onExport: config?.onExport,
})

const normalizeKeyboardShortcutConfig = <RecordType extends object>(
    config?: InfiniteVirtualTableKeyboardShortcuts<RecordType>,
) => {
    const enabled = config?.enabled ?? true
    return {
        enabled,
        selection: normalizeSelectionShortcuts(enabled, config?.selection),
        rows: normalizeRowShortcuts<RecordType>(config?.rows),
    }
}

const resolveRowKey = <RecordType extends object>(
    rowKey: InfiniteVirtualTableProps<RecordType>["rowKey"],
    record: RecordType,
    index: number,
): Key | null => {
    if (typeof rowKey === "function") {
        const value = rowKey(record, index)
        return value === undefined || value === null ? null : (value as Key)
    }
    if (typeof rowKey === "string") {
        const value = (record as Record<string, unknown>)[rowKey]
        return value === undefined || value === null ? null : (value as Key)
    }
    const fallback = (record as Record<string, unknown>).key ?? index
    return (fallback as Key) ?? null
}

const usePointerScopeTracker = (
    containerRef: RefObject<HTMLElement | null>,
    active: boolean,
    enabled: boolean,
): MutableRefObject<boolean> => {
    const scopeRef = useRef(false)

    useEffect(() => {
        if (!enabled) return
        const handlePointerDown = (event: PointerEvent) => {
            const container = containerRef.current
            if (!container || !active) {
                scopeRef.current = false
                return
            }
            scopeRef.current = container.contains(event.target as Node)
        }
        document.addEventListener("pointerdown", handlePointerDown, true)
        return () => document.removeEventListener("pointerdown", handlePointerDown, true)
    }, [active, containerRef, enabled])

    useEffect(() => {
        if (!enabled) return
        const container = containerRef.current
        if (!container) return
        const handlePointerEnter = () => {
            if (!active) return
            scopeRef.current = true
        }
        const handlePointerLeave = (event: PointerEvent) => {
            const related = event.relatedTarget as Node | null
            if (related && container.contains(related)) return
            scopeRef.current = false
        }
        container.addEventListener("pointerenter", handlePointerEnter, true)
        container.addEventListener("pointerleave", handlePointerLeave, true)
        return () => {
            container.removeEventListener("pointerenter", handlePointerEnter, true)
            container.removeEventListener("pointerleave", handlePointerLeave, true)
        }
    }, [active, containerRef, enabled])

    useEffect(() => {
        if (!active) {
            scopeRef.current = false
        }
    }, [active])

    return scopeRef
}

const dedupeKeys = (keys: Key[]) => {
    const seen = new Set<Key>()
    const result: Key[] = []
    keys.forEach((key) => {
        if (seen.has(key)) return
        seen.add(key)
        result.push(key)
    })
    return result
}

const escapeSelector = (value: Key) => {
    const str = String(value)
    if (
        typeof window !== "undefined" &&
        typeof window.CSS !== "undefined" &&
        typeof window.CSS.escape === "function"
    ) {
        return window.CSS.escape(str)
    }
    return str.replace(/['"\\]/g, "\\$&")
}

function useTableKeyboardShortcuts<RecordType extends object>({
    containerRef,
    dataSource,
    rowKey,
    rowSelection,
    keyboardShortcuts,
    active,
}: UseTableKeyboardShortcutsParams<RecordType>): TableShortcutResult<RecordType> {
    const resolvedConfig = useMemo(
        () => normalizeKeyboardShortcutConfig<RecordType>(keyboardShortcuts),
        [keyboardShortcuts],
    )
    const selectionShortcuts = resolvedConfig.selection
    const rowShortcuts = resolvedConfig.rows
    const hasSelectionControls = Boolean(rowSelection && rowSelection.onChange)
    const selectionEnabled = selectionShortcuts.enabled && hasSelectionControls

    const navigableEntries = useMemo<SelectableEntry<RecordType>[]>(() => {
        const entries: SelectableEntry<RecordType>[] = []
        dataSource.forEach((record, index) => {
            const key = resolveRowKey(rowKey, record, index)
            if (key === null || key === undefined) return
            if ((record as any)?.__isSkeleton) return
            const position = entries.length
            entries.push({key, record, position})
        })
        return entries
    }, [dataSource, rowKey])

    const navigableMap = useMemo(() => {
        const map = new Map<Key, SelectableEntry<RecordType>>()
        navigableEntries.forEach((entry) => {
            map.set(entry.key, entry)
        })
        return map
    }, [navigableEntries])

    const selectableEntries = useMemo<SelectableEntry<RecordType>[]>(() => {
        if (!selectionEnabled || !rowSelection) return []
        const entries: SelectableEntry<RecordType>[] = []
        dataSource.forEach((record, index) => {
            const key = resolveRowKey(rowKey, record, index)
            if (key === null || key === undefined) return
            const checkboxProps = rowSelection.getCheckboxProps?.(record) ?? {}
            if (checkboxProps.disabled) return
            const position = entries.length
            entries.push({key, record, position})
        })
        return entries
    }, [dataSource, rowKey, rowSelection, selectionEnabled])

    const keyToEntry = useMemo(() => {
        const map = new Map<Key, SelectableEntry<RecordType>>()
        selectableEntries.forEach((entry) => {
            map.set(entry.key, entry)
        })
        return map
    }, [selectableEntries])

    const selectedKeys = useMemo<Key[]>(() => {
        if (!selectionEnabled || !rowSelection) return []
        return (rowSelection.selectedRowKeys ?? []).filter((key) => keyToEntry.has(key))
    }, [keyToEntry, rowSelection, selectionEnabled])

    const selectedKeySet = useMemo(() => new Set(selectedKeys), [selectedKeys])
    const allowsMultipleSelection = rowSelection?.type !== "radio"

    const anchorKeyRef = useRef<Key | null>(null)
    const activeKeyRef = useRef<Key | null>(null)
    const highlightEntryRef = useRef<SelectableEntry<RecordType> | null>(null)
    const [highlightedKey, setHighlightedKey] = useState<Key | null>(null)

    useEffect(() => {
        if (!selectionEnabled) {
            anchorKeyRef.current = null
            activeKeyRef.current = null
            return
        }
        if (!selectedKeys.length) {
            anchorKeyRef.current = null
            activeKeyRef.current = null
            return
        }
        const lastKey = selectedKeys[selectedKeys.length - 1]
        activeKeyRef.current = lastKey
        if (!anchorKeyRef.current || !selectedKeySet.has(anchorKeyRef.current)) {
            anchorKeyRef.current = lastKey
        }
    }, [selectedKeySet, selectedKeys, selectionEnabled])

    const pointerScopeRef = usePointerScopeTracker(containerRef, active, resolvedConfig.enabled)

    const triggerSelectionChange = useCallback(
        (nextKeys: Key[], opts?: {anchorKey?: Key | null; activeKey?: Key | null}) => {
            if (!rowSelection?.onChange) return
            const normalizedKeys = dedupeKeys(
                nextKeys.filter((key) => keyToEntry.has(key)),
            ) as Key[]
            const rows = normalizedKeys.map((key) => keyToEntry.get(key)!.record)
            rowSelection.onChange(normalizedKeys, rows)
            if (opts) {
                if ("anchorKey" in opts) {
                    anchorKeyRef.current = opts.anchorKey ?? null
                }
                if ("activeKey" in opts) {
                    activeKeyRef.current = opts.activeKey ?? null
                }
            }
        },
        [keyToEntry, rowSelection],
    )

    const handleSelectAll = useCallback(() => {
        if (!selectionEnabled || !selectionShortcuts.selectAll) return
        if (!allowsMultipleSelection) return
        if (!selectableEntries.length) return
        const keys = selectableEntries.map((entry) => entry.key)
        const firstKey = keys[0]
        const lastKey = keys[keys.length - 1]
        triggerSelectionChange(keys, {anchorKey: firstKey, activeKey: lastKey})
    }, [
        allowsMultipleSelection,
        selectableEntries,
        selectionEnabled,
        selectionShortcuts.selectAll,
        triggerSelectionChange,
    ])

    const handleClearSelection = useCallback(() => {
        if (!selectionEnabled || !selectionShortcuts.clear) return
        triggerSelectionChange([], {anchorKey: null, activeKey: null})
    }, [selectionEnabled, selectionShortcuts.clear, triggerSelectionChange])

    const handleMove = useCallback(
        (direction: 1 | -1, extend: boolean) => {
            if (!selectionEnabled || !selectionShortcuts.navigation) return
            if (!selectableEntries.length) return

            const currentActiveKey = activeKeyRef.current
            const activeEntry = currentActiveKey ? keyToEntry.get(currentActiveKey) : undefined
            let nextPosition: number
            if (!activeEntry) {
                nextPosition = direction > 0 ? 0 : selectableEntries.length - 1
            } else {
                nextPosition = activeEntry.position + direction
                if (nextPosition < 0 || nextPosition >= selectableEntries.length) {
                    return
                }
            }
            const nextEntry = selectableEntries[nextPosition]
            if (!nextEntry) return

            const shouldExtend =
                extend &&
                allowsMultipleSelection &&
                selectionShortcuts.range &&
                selectableEntries.length

            if (!shouldExtend) {
                triggerSelectionChange([nextEntry.key], {
                    anchorKey: nextEntry.key,
                    activeKey: nextEntry.key,
                })
                return
            }

            const anchorKey = anchorKeyRef.current ?? nextEntry.key
            const anchorEntry = keyToEntry.get(anchorKey)
            if (!anchorEntry) {
                triggerSelectionChange([nextEntry.key], {
                    anchorKey: nextEntry.key,
                    activeKey: nextEntry.key,
                })
                return
            }

            const start = Math.min(anchorEntry.position, nextPosition)
            const end = Math.max(anchorEntry.position, nextPosition)
            const rangeKeys = selectableEntries.slice(start, end + 1).map((entry) => entry.key)
            triggerSelectionChange(rangeKeys, {
                anchorKey: anchorEntry.key,
                activeKey: nextEntry.key,
            })
        },
        [
            allowsMultipleSelection,
            keyToEntry,
            selectableEntries,
            selectionEnabled,
            selectionShortcuts.navigation,
            selectionShortcuts.range,
            triggerSelectionChange,
        ],
    )

    const scrollRowIntoView = useCallback(
        (key: Key) => {
            if (!rowShortcuts.scrollIntoViewOnChange) return
            const container = containerRef.current
            if (!container) return
            const selector = escapeSelector(key)
            const row =
                container.querySelector<HTMLElement>(`[data-row-key="${selector}"]`) ??
                container.querySelector<HTMLElement>(`[data-row-key='${selector}']`)
            row?.scrollIntoView({block: "nearest"})
        },
        [containerRef, rowShortcuts.scrollIntoViewOnChange],
    )

    const setHighlightEntry = useCallback(
        (entry: SelectableEntry<RecordType> | null, options?: {scroll?: boolean}) => {
            highlightEntryRef.current = entry
            const nextKey = entry?.key ?? null
            setHighlightedKey((current) => (current === nextKey ? current : nextKey))
            rowShortcuts.onHighlightChange?.({key: nextKey, record: entry?.record ?? null})
            if (options?.scroll && entry?.key) {
                scrollRowIntoView(entry.key)
            }
        },
        [rowShortcuts, scrollRowIntoView],
    )

    useEffect(() => {
        if (!rowShortcuts.enabled) return
        if (highlightEntryRef.current && navigableMap.has(highlightEntryRef.current.key)) {
            return
        }
        if (!rowShortcuts.autoHighlightFirstRow) {
            setHighlightEntry(null)
            return
        }
        const firstEntry = navigableEntries[0] ?? null
        setHighlightEntry(firstEntry ?? null, {scroll: false})
    }, [
        navigableEntries,
        navigableMap,
        rowShortcuts.autoHighlightFirstRow,
        rowShortcuts.enabled,
        setHighlightEntry,
    ])

    const moveHighlight = useCallback(
        (direction: 1 | -1) => {
            if (!rowShortcuts.enabled || !navigableEntries.length) return false
            const current = highlightEntryRef.current
            if (!current) {
                const target =
                    direction > 0
                        ? navigableEntries[0]
                        : navigableEntries[navigableEntries.length - 1]
                setHighlightEntry(target, {scroll: true})
                return Boolean(target)
            }
            const nextIndex = current.position + direction
            if (nextIndex < 0 || nextIndex >= navigableEntries.length) {
                return false
            }
            const nextEntry = navigableEntries[nextIndex]
            setHighlightEntry(nextEntry, {scroll: true})
            return true
        },
        [navigableEntries, rowShortcuts.enabled, setHighlightEntry],
    )

    const toggleHighlightedSelection = useCallback(() => {
        if (!rowShortcuts.enabled || !rowShortcuts.toggleSelectionWithSpace) return false
        if (!rowSelection?.onChange) return false
        const entry = highlightEntryRef.current
        if (!entry) return false
        const isSelected = selectedKeySet.has(entry.key)
        const nextKeys = isSelected
            ? selectedKeys.filter((key) => key !== entry.key)
            : [...selectedKeys, entry.key]
        triggerSelectionChange(nextKeys)
        return true
    }, [
        rowSelection,
        rowShortcuts.enabled,
        rowShortcuts.toggleSelectionWithSpace,
        selectedKeySet,
        selectedKeys,
        triggerSelectionChange,
    ])

    const openHighlightedRow = useCallback(() => {
        if (!rowShortcuts.enabled || !rowShortcuts.onOpen) return false
        const entry = highlightEntryRef.current
        if (!entry) return false
        rowShortcuts.onOpen({key: entry.key, record: entry.record})
        return true
    }, [rowShortcuts])

    const deleteHighlightedRow = useCallback(() => {
        if (!rowShortcuts.enabled || !rowShortcuts.onDelete) return false
        const entry = highlightEntryRef.current
        if (!entry) return false
        const isSelected = selectedKeySet.has(entry.key)
        rowShortcuts.onDelete({
            key: entry.key,
            record: entry.record,
            selected: isSelected,
            selection: selectedKeys,
        })
        return true
    }, [rowShortcuts, selectedKeySet, selectedKeys])

    const getRowProps = useCallback(
        (record: RecordType, index: number) => {
            if (!rowShortcuts.enabled) return undefined
            const key = resolveRowKey(rowKey, record, index)
            if (key === null || key === undefined) return undefined
            const isHighlighted = highlightedKey !== null && key === highlightedKey
            const props: Record<string, any> = {"data-ivt-row-key": key}
            if (isHighlighted) {
                props.className = rowShortcuts.highlightClassName
            }
            if (rowShortcuts.highlightOnHover !== false) {
                props.onMouseEnter = () => {
                    const entry = navigableMap.get(key)
                    if (entry) {
                        setHighlightEntry(entry)
                    }
                }
            }
            return props
        },
        [highlightedKey, navigableMap, rowKey, rowShortcuts, setHighlightEntry],
    )

    useEffect(() => {
        if (!resolvedConfig.enabled || (!selectionEnabled && !rowShortcuts.enabled)) return
        const handleKeyDown = (event: KeyboardEvent) => {
            if (!active) return
            if (!pointerScopeRef.current) return
            const target = event.target as HTMLElement | null
            if (isInteractiveTarget(target)) {
                return
            }

            const isArrowKey = event.key === "ArrowDown" || event.key === "ArrowUp"
            const direction = event.key === "ArrowDown" ? 1 : -1

            if (isArrowKey) {
                let handled = false
                if (rowShortcuts.enabled) {
                    handled = moveHighlight(direction as 1 | -1) || handled
                }
                if (selectionShortcuts.navigation) {
                    handleMove(direction as 1 | -1, event.shiftKey)
                    handled = true
                }
                if (handled) {
                    event.preventDefault()
                    return
                }
            }

            const isModifier = event.metaKey || event.ctrlKey
            if (
                selectionShortcuts.selectAll &&
                allowsMultipleSelection &&
                isModifier &&
                event.key.toLowerCase() === "a"
            ) {
                event.preventDefault()
                handleSelectAll()
                return
            }

            if (event.key === "Escape") {
                let handled = false
                if (selectionShortcuts.clear && selectedKeys.length) {
                    handleClearSelection()
                    handled = true
                } else if (
                    rowShortcuts.enabled &&
                    highlightEntryRef.current &&
                    !selectedKeySet.has(highlightEntryRef.current.key)
                ) {
                    setHighlightEntry(null)
                    handled = true
                }
                if (handled) {
                    event.preventDefault()
                    return
                }
            }

            if (rowShortcuts.enabled && (event.key === " " || event.code === "Space")) {
                if (toggleHighlightedSelection()) {
                    event.preventDefault()
                }
                return
            }

            if (
                rowShortcuts.enabled &&
                rowShortcuts.onExport &&
                isModifier &&
                (event.key === "Enter" || event.key.toLowerCase() === "e")
            ) {
                rowShortcuts.onExport({
                    key: highlightEntryRef.current?.key ?? null,
                    record: highlightEntryRef.current?.record ?? null,
                    selection: selectedKeys,
                })
                event.preventDefault()
                return
            }

            if (rowShortcuts.enabled && event.key === "Enter") {
                if (openHighlightedRow()) {
                    event.preventDefault()
                }
                return
            }

            if (rowShortcuts.enabled && event.key === "Backspace") {
                if (deleteHighlightedRow()) {
                    event.preventDefault()
                }
            }
        }

        window.addEventListener("keydown", handleKeyDown)
        return () => window.removeEventListener("keydown", handleKeyDown)
    }, [
        active,
        allowsMultipleSelection,
        deleteHighlightedRow,
        handleClearSelection,
        handleMove,
        handleSelectAll,
        moveHighlight,
        openHighlightedRow,
        pointerScopeRef,
        resolvedConfig.enabled,
        rowShortcuts.enabled,
        selectionEnabled,
        selectionShortcuts.clear,
        selectionShortcuts.navigation,
        selectionShortcuts.selectAll,
        toggleHighlightedSelection,
    ])

    return {
        getRowProps: rowShortcuts.enabled ? getRowProps : undefined,
    }
}

export default useTableKeyboardShortcuts
