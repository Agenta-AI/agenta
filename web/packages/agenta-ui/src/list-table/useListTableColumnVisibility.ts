import {useCallback, useMemo, useSyncExternalStore} from "react"

import type {ListTableColumn} from "./types"

const STORAGE_PREFIX = "agenta:list-table:hidden-columns:"

/**
 * The hidden keys as stored, per list. Also kept in memory, so the menu still works for the
 * session when the browser blocks storage (a private window, cleared site data).
 */
const memory = new Map<string, string>()
const listeners = new Set<() => void>()

const notify = () => listeners.forEach((listener) => listener())

const subscribe = (listener: () => void) => {
    listeners.add(listener)
    // A change in another tab arrives as a `storage` event; drop the memory copy so it is read again.
    const onStorage = (event: StorageEvent) => {
        if (!event.key?.startsWith(STORAGE_PREFIX)) return
        memory.delete(event.key)
        listener()
    }
    window.addEventListener("storage", onStorage)
    return () => {
        listeners.delete(listener)
        window.removeEventListener("storage", onStorage)
    }
}

const readRaw = (key: string): string | null => {
    const kept = memory.get(key)
    if (kept !== undefined) return kept
    try {
        return window.localStorage.getItem(key)
    } catch {
        return null
    }
}

const parse = (raw: string | null): string[] => {
    if (!raw) return []
    try {
        const value: unknown = JSON.parse(raw)
        return Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : []
    } catch {
        return []
    }
}

const writeKeys = (key: string, keys: string[]) => {
    const raw = JSON.stringify(keys)
    memory.set(key, raw)
    try {
        window.localStorage.setItem(key, raw)
    } catch {
        // Storage is blocked or full: the memory copy keeps the choice for this session.
    }
    notify()
}

/** Control columns (`srOnly`) and columns marked `hideable: false` are always drawn. */
export const isColumnHideable = (column: ListTableColumn) =>
    !column.srOnly && column.hideable !== false

/**
 * Which columns of a list the reader chose to hide, kept per browser under `storageKey`.
 *
 * The frame draws whatever columns it gets, so the list passes `visibleColumns` to
 * {@link ListTable} and draws a cell only when `isVisible(column.key)`. On the server and in
 * the first render every column is visible, so the markup matches before storage is read.
 */
export const useListTableColumnVisibility = ({
    storageKey,
    columns,
}: {
    /** One per list, for example `"testsets"`. */
    storageKey: string
    columns: ListTableColumn[]
}) => {
    const key = STORAGE_PREFIX + storageKey
    const raw = useSyncExternalStore(
        subscribe,
        () => readRaw(key),
        () => null,
    )
    const hiddenKeys = useMemo(() => {
        const stored = new Set(parse(raw))
        return new Set(
            columns
                .filter((column) => isColumnHideable(column) && stored.has(column.key))
                .map((column) => column.key),
        )
    }, [raw, columns])
    const visibleColumns = useMemo(
        () => columns.filter((column) => !hiddenKeys.has(column.key)),
        [columns, hiddenKeys],
    )
    const isVisible = useCallback((columnKey: string) => !hiddenKeys.has(columnKey), [hiddenKeys])
    const setColumnVisible = useCallback(
        (columnKey: string, visible: boolean) => {
            const next = new Set(parse(readRaw(key)))
            if (visible) next.delete(columnKey)
            else next.add(columnKey)
            writeKeys(key, [...next])
        },
        [key],
    )
    return {visibleColumns, hiddenKeys, isVisible, setColumnVisible}
}
