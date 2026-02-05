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
            const typedColumn = column as ColumnsType<RecordType>[number] & {
                children?: ColumnsType<RecordType>
            }
            if (!typedColumn) return
            const columnKey = typedColumn.key
            const isFixed = Boolean(typedColumn.fixed)
            if (isFixed && columnKey !== undefined && columnKey !== null) {
                keys.add(String(columnKey))
            }
            if (typedColumn.children && typedColumn.children.length) {
                visit(typedColumn.children)
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
        const typedColumn = column as ColumnsType<RecordType>[number] & {
            children?: ColumnsType<RecordType>
        }
        if (!typedColumn) return []
        const key = toColumnKey(typedColumn.key)
        const childColumns = Array.isArray(typedColumn.children) ? typedColumn.children : null
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
 * Merges two optional event handlers into one.
 * Note: Uses 'any' for args because event handlers have varying signatures
 * (MouseEvent, KeyboardEvent, etc.) that cannot be unified with unknown[].
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
export const mergeHandlers = <
    T extends (...args: any[]) => void,
    U extends (...args: any[]) => void,
>(
    first?: T,
    second?: U,
): ((...args: Parameters<T>) => void) | undefined => {
    if (!first && !second) return undefined
    if (!first) return second as ((...args: Parameters<T>) => void) | undefined
    if (!second) return first
    return (...args: any[]) => {
        first(...args)
        second(...args)
    }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Shallow equality check for objects
 */
export const shallowEqual = <T extends object>(a: T | null, b: T): boolean => {
    if (a === b) return true
    if (!a || !b) return false
    const keysA = Object.keys(a) as (keyof T)[]
    const keysB = Object.keys(b) as (keyof T)[]
    if (keysA.length !== keysB.length) return false
    for (const key of keysA) {
        if (a[key] !== b[key]) return false
    }
    return true
}
