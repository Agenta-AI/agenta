import type {
    TestcaseDataEditorColumn,
    TestcaseDataEditorFeatures,
    TestcaseDataEditorResolvedFeatures,
    TestcaseDataEditorRootItem,
    TestcaseDataEditorSurface,
} from "./TestcaseDataEditor.types"

type NativePath = (string | number)[]

export function normalizeTestcaseData(
    value: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {}
}

function normalizeObjectValue(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value)
}

function getColumnPath(column: TestcaseDataEditorColumn): string[] {
    return column.key.split(".")
}

function shouldUseNestedPath(
    value: Record<string, unknown>,
    column: TestcaseDataEditorColumn,
): boolean {
    const mode = column.pathMode ?? "direct"
    if (mode === "nested") return true
    if (mode === "direct") return false
    return value[column.key] === undefined && column.key.includes(".")
}

function getNativeValueAtPath(data: unknown, path: NativePath): unknown {
    if (path.length === 0) return data

    let current = data
    for (const key of path) {
        if (current === null || current === undefined) return undefined

        if (Array.isArray(current)) {
            const index = typeof key === "number" ? key : Number(key)
            if (!Number.isInteger(index) || String(index) !== String(key)) return undefined
            current = current[index]
            continue
        }

        if (!isRecord(current)) return undefined
        current = current[String(key)]
    }

    return current
}

function hasNativeValueAtPath(data: unknown, path: NativePath): boolean {
    if (path.length === 0) return data !== undefined

    const parent = getNativeValueAtPath(data, path.slice(0, -1))
    if (parent === null || parent === undefined) return false

    const key = path[path.length - 1]
    if (Array.isArray(parent)) {
        const index = typeof key === "number" ? key : Number(key)
        return Number.isInteger(index) && String(index) === String(key) && index in parent
    }

    return isRecord(parent) && Object.prototype.hasOwnProperty.call(parent, String(key))
}

function createContainerFor(
    nextKey: string | number | undefined,
): Record<string, unknown> | unknown[] {
    if (nextKey === undefined) return {}
    const numericKey = typeof nextKey === "number" ? nextKey : Number(nextKey)
    return Number.isInteger(numericKey) && String(numericKey) === String(nextKey) ? [] : {}
}

function setNativeValueAtPath(data: unknown, path: NativePath, value: unknown): unknown {
    if (path.length === 0) return value

    const [key, ...rest] = path
    const nextKey = rest[0]

    if (Array.isArray(data)) {
        const index = typeof key === "number" ? key : Number(key)
        if (!Number.isInteger(index) || String(index) !== String(key) || index < 0) {
            return data
        }

        const next = [...data]
        next[index] =
            rest.length === 0
                ? value
                : setNativeValueAtPath(next[index] ?? createContainerFor(nextKey), rest, value)
        return next
    }

    const record = isRecord(data) ? data : {}
    const strKey = String(key)

    if (rest.length === 0) {
        return {...record, [strKey]: value}
    }

    return {
        ...record,
        [strKey]: setNativeValueAtPath(record[strKey] ?? createContainerFor(nextKey), rest, value),
    }
}

function buildProjectedTestcaseValue(
    value: Record<string, unknown>,
    columns: TestcaseDataEditorColumn[],
    options?: {includeEmpty?: boolean},
): Record<string, unknown> {
    let projected: Record<string, unknown> = {}
    const orderedColumns = [...columns].sort((a, b) => {
        return Number(shouldUseNestedPath(value, a)) - Number(shouldUseNestedPath(value, b))
    })

    for (const column of orderedColumns) {
        const columnValue = getTestcaseColumnValue(value, column)
        if (columnValue === undefined && !options?.includeEmpty) continue

        const nextValue = columnValue ?? ""
        if (shouldUseNestedPath(value, column)) {
            projected = normalizeTestcaseData(
                setNativeValueAtPath(projected, getColumnPath(column), nextValue) as Record<
                    string,
                    unknown
                >,
            )
        } else {
            projected = {...projected, [column.key]: nextValue}
        }
    }

    return projected
}

export function resolveTestcaseEditorFeatures(
    surface: TestcaseDataEditorSurface,
    features?: TestcaseDataEditorFeatures,
): TestcaseDataEditorResolvedFeatures {
    const defaults: Record<TestcaseDataEditorSurface, TestcaseDataEditorResolvedFeatures> = {
        drawer: {
            typeChips: true,
            rootViewMode: true,
            columnMapping: true,
            showProperties: false,
        },
        playground: {
            typeChips: true,
            rootViewMode: true,
            columnMapping: false,
            showProperties: false,
        },
        inline: {
            typeChips: true,
            rootViewMode: true,
            columnMapping: false,
            showProperties: false,
        },
    }

    return {...defaults[surface], ...features}
}

export function getTestcaseColumnValue(
    value: Record<string, unknown>,
    column: TestcaseDataEditorColumn,
): unknown {
    const mode = column.pathMode ?? "direct"

    if (mode === "direct") {
        return value[column.key]
    }

    if (mode === "nested") {
        return getNativeValueAtPath(value, getColumnPath(column))
    }

    const directValue = value[column.key]
    return directValue !== undefined
        ? directValue
        : getNativeValueAtPath(value, getColumnPath(column))
}

export function getTestcaseRootItems(
    value: Record<string, unknown>,
    columns?: TestcaseDataEditorColumn[],
): TestcaseDataEditorRootItem[] {
    if (columns?.length) {
        const projected = buildProjectedTestcaseValue(value, columns, {includeEmpty: true})
        const rootItems = new Map<string, TestcaseDataEditorRootItem>()

        for (const column of columns) {
            const isNested = shouldUseNestedPath(value, column)
            const rootKey = isNested ? getColumnPath(column)[0] : column.key
            if (!rootKey || rootItems.has(rootKey)) continue

            const directRootColumn = columns.find(
                (candidate) => candidate.key === rootKey && !shouldUseNestedPath(value, candidate),
            )

            rootItems.set(rootKey, {
                key: rootKey,
                name:
                    directRootColumn?.label ??
                    directRootColumn?.name ??
                    (isNested ? rootKey : (column.label ?? column.name ?? column.key)),
                value: projected[rootKey],
                isColumn: true,
            })
        }

        return Array.from(rootItems.values())
    }

    return Object.keys(value)
        .sort()
        .map((key) => ({
            key,
            name: key,
            value: value[key],
            isColumn: false,
        }))
}

export function setTestcaseColumnValue(
    value: Record<string, unknown>,
    column: TestcaseDataEditorColumn,
    nextValue: unknown,
): Record<string, unknown> {
    const mode = column.pathMode ?? "direct"

    if (mode === "nested") {
        return normalizeTestcaseData(
            setNativeValueAtPath(value, getColumnPath(column), nextValue) as Record<
                string,
                unknown
            >,
        )
    }

    if (mode === "auto" && value[column.key] === undefined) {
        return normalizeTestcaseData(
            setNativeValueAtPath(value, getColumnPath(column), nextValue) as Record<
                string,
                unknown
            >,
        )
    }

    return {...value, [column.key]: nextValue}
}

function hasTestcaseColumnValue(
    value: Record<string, unknown>,
    column: TestcaseDataEditorColumn,
): boolean {
    const mode = column.pathMode ?? "direct"

    if (mode === "direct") {
        return Object.prototype.hasOwnProperty.call(value, column.key)
    }

    if (mode === "nested") {
        return hasNativeValueAtPath(value, getColumnPath(column))
    }

    return (
        Object.prototype.hasOwnProperty.call(value, column.key) ||
        hasNativeValueAtPath(value, getColumnPath(column))
    )
}

export function buildTestcaseCodeEditorValue(
    value: Record<string, unknown>,
    columns?: TestcaseDataEditorColumn[],
): Record<string, unknown> {
    if (!columns?.length) return value
    return buildProjectedTestcaseValue(value, columns)
}

export function mergeTestcaseCodeEditorValue(
    value: Record<string, unknown>,
    nextValue: Record<string, unknown>,
    columns?: TestcaseDataEditorColumn[],
): Record<string, unknown> {
    if (!columns?.length) return nextValue

    let merged = value

    for (const column of columns) {
        if (hasTestcaseColumnValue(nextValue, column)) {
            merged = setTestcaseColumnValue(
                merged,
                column,
                getTestcaseColumnValue(nextValue, column),
            )
        }
    }

    return merged
}

export function getTestcasePathValue(
    value: Record<string, unknown>,
    path: string[],
    columns?: TestcaseDataEditorColumn[],
): unknown {
    if (path.length === 0) return value
    if (!columns?.length) return getNativeValueAtPath(value, path)

    const projected = buildProjectedTestcaseValue(value, columns, {includeEmpty: true})
    return getNativeValueAtPath(projected, path)
}

export function setTestcasePathValue(
    value: Record<string, unknown>,
    path: string[],
    nextValue: unknown,
    columns?: TestcaseDataEditorColumn[],
): Record<string, unknown> {
    if (path.length === 0) {
        return normalizeTestcaseData(nextValue as Record<string, unknown>)
    }

    const column = columns?.find((candidate) => candidate.key === path[0])
    if (!column) {
        return normalizeTestcaseData(
            setNativeValueAtPath(value, path, nextValue) as Record<string, unknown>,
        )
    }

    if (path.length === 1) {
        return setTestcaseColumnValue(value, column, nextValue)
    }

    const currentColumnValue = getTestcaseColumnValue(value, column)
    const nextColumnValue = setNativeValueAtPath(
        normalizeObjectValue(currentColumnValue),
        path.slice(1),
        nextValue,
    )

    return setTestcaseColumnValue(value, column, nextColumnValue)
}
