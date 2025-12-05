import type {Key} from "react"

import type {ColumnsType} from "antd/es/table"

/**
 * Collects all column keys that have `fixed` property set
 */
export const collectFixedColumnKeys = <RecordType extends object>(
    columns: ColumnsType<RecordType>,
): string[] => {
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

/**
 * Converts a Key to string or null
 */
export const toColumnKey = (key: Key | undefined): string | null =>
    key === undefined || key === null ? null : String(key)

/**
 * Builds a map of parent column keys to their descendant leaf keys
 */
export const buildColumnDescendantMap = <RecordType extends object>(
    columns: ColumnsType<RecordType>,
): Map<string, string[]> => {
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

/**
 * Merges two optional event handlers into one
 */
export const mergeHandlers = <
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

/**
 * Shallow equality check for objects
 */
export const shallowEqual = (a: Record<string, any> | null, b: Record<string, any>): boolean => {
    if (a === b) return true
    if (!a || !b) return false
    const keysA = Object.keys(a)
    const keysB = Object.keys(b)
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
        if (a[key] !== b[key]) return false
    }
    return true
}
