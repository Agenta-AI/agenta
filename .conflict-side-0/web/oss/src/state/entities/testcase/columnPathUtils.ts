import {deleteValueAtPath, getValueAtPath, parsePath, type DataPath} from "@agenta/shared/utils"

export interface TestcaseColumnMetadata {
    key: string
    name: string
    parentKey?: string
    subKey?: string
}

interface NestedColumnParts {
    parentKey: string
    subKey: string
}

function getNestedColumnParts(key: string): NestedColumnParts | null {
    const segments = key.split(".")
    if (segments.length < 2 || segments.some((segment) => segment.length === 0)) {
        return null
    }

    return {
        parentKey: segments.slice(0, -1).join("."),
        subKey: segments[segments.length - 1],
    }
}

export function createColumnFromKey(key: string): TestcaseColumnMetadata {
    const nestedParts = getNestedColumnParts(key)
    if (!nestedParts) {
        return {key, name: key}
    }

    return {
        key,
        name: nestedParts.subKey,
        parentKey: nestedParts.parentKey,
        subKey: nestedParts.subKey,
    }
}

export function isNestedColumn(column: {
    parentKey?: unknown
    subKey?: unknown
}): column is TestcaseColumnMetadata & {parentKey: string; subKey: string} {
    return typeof column.parentKey === "string" && typeof column.subKey === "string"
}

export function tryParseAsObjectColumnValue(value: unknown): Record<string, unknown> | null {
    if (Array.isArray(value)) {
        return null
    }

    if (value && typeof value === "object") {
        return value as Record<string, unknown>
    }

    return null
}

export function isArrayColumnValue(value: unknown): boolean {
    return Array.isArray(value)
}

export function getColumnValueFromRecord(
    record: Record<string, unknown> | null | undefined,
    column: string,
): unknown {
    if (!record) return undefined

    const directValue = record[column]
    if (directValue !== undefined) {
        return directValue
    }

    const parts = column.split(".")
    if (parts.length === 1) {
        return undefined
    }

    let current: unknown = record

    for (const part of parts) {
        if (current === undefined || current === null) {
            return undefined
        }

        if (Array.isArray(current)) {
            const index = Number(part)
            if (!Number.isInteger(index) || String(index) !== part) {
                return undefined
            }
            current = current[index]
            continue
        }

        if (typeof current !== "object") {
            return undefined
        }

        current = (current as Record<string, unknown>)[part]
    }

    return current
}

function isEmptyObjectLike(value: unknown): boolean {
    if (!value || typeof value !== "object") {
        return false
    }

    return !Array.isArray(value) && Object.keys(value).length === 0
}

function pruneEmptyAncestorPaths(
    record: Record<string, unknown>,
    deletedPath: DataPath,
    options?: {preserveRoot?: boolean},
): Record<string, unknown> {
    let next = record
    const minDepth = options?.preserveRoot ? 2 : 1

    for (let depth = deletedPath.length - 1; depth >= minDepth; depth--) {
        const ancestorPath = deletedPath.slice(0, depth)
        const ancestorValue = getValueAtPath(next, ancestorPath)

        if (!isEmptyObjectLike(ancestorValue)) {
            break
        }

        next = deleteValueAtPath(next, ancestorPath) as Record<string, unknown>
    }

    return next
}

export function buildDeleteColumnValueUpdates(
    record: Record<string, unknown>,
    columnKey: string,
): Record<string, unknown> | null {
    if (!columnKey) {
        return null
    }

    if (columnKey in record) {
        return {
            [columnKey]: undefined,
        }
    }

    if (!columnKey.includes(".")) {
        return null
    }

    const path = parsePath(columnKey)
    if (path.length < 2 || getColumnValueFromRecord(record, columnKey) === undefined) {
        return null
    }

    const updatedRecord = pruneEmptyAncestorPaths(
        deleteValueAtPath(record, path) as Record<string, unknown>,
        path,
        {preserveRoot: true},
    )
    const rootKey = String(path[0])

    return {
        [rootKey]: updatedRecord[rootKey],
    }
}
