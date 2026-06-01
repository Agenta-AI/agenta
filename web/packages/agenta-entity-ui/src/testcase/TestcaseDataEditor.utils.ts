import {getValueAtPath, hasValueAtPath, setValueAtPath, type DataPath} from "@agenta/shared/utils"

import type {
    TestcaseDataEditorColumn,
    TestcaseDataEditorFeatures,
    TestcaseDataEditorResolvedFeatures,
    TestcaseDataEditorRootItem,
    TestcaseDataEditorSurface,
} from "./TestcaseDataEditor.types"

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
        return getValueAtPath(value, column.key.split("."))
    }

    const directValue = value[column.key]
    return directValue !== undefined ? directValue : getValueAtPath(value, column.key.split("."))
}

export function getTestcaseRootItems(
    value: Record<string, unknown>,
    columns?: TestcaseDataEditorColumn[],
): TestcaseDataEditorRootItem[] {
    if (columns?.length) {
        return columns.map((column) => ({
            key: column.key,
            name: column.label ?? column.name ?? column.key,
            value: getTestcaseColumnValue(value, column) ?? "",
            isColumn: true,
        }))
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
            setValueAtPath(value, column.key.split(".") as DataPath, nextValue) as Record<
                string,
                unknown
            >,
        )
    }

    if (mode === "auto" && value[column.key] === undefined) {
        return normalizeTestcaseData(
            setValueAtPath(value, column.key.split(".") as DataPath, nextValue) as Record<
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
        return hasValueAtPath(value, column.key.split("."))
    }

    return (
        Object.prototype.hasOwnProperty.call(value, column.key) ||
        hasValueAtPath(value, column.key.split("."))
    )
}

export function buildTestcaseCodeEditorValue(
    value: Record<string, unknown>,
    columns?: TestcaseDataEditorColumn[],
): Record<string, unknown> {
    if (!columns?.length) return value

    let subset: Record<string, unknown> = {}

    for (const column of columns) {
        const columnValue = getTestcaseColumnValue(value, column)
        if (columnValue !== undefined) {
            subset = setTestcaseColumnValue(subset, column, columnValue)
        }
    }

    return subset
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

    const column = columns?.find((candidate) => candidate.key === path[0])
    if (!column) return getValueAtPath(value, path)

    const columnValue = getTestcaseColumnValue(value, column)
    if (path.length === 1) return columnValue
    return getValueAtPath(normalizeObjectValue(columnValue), path.slice(1))
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
            setValueAtPath(value, path as DataPath, nextValue) as Record<string, unknown>,
        )
    }

    if (path.length === 1) {
        return setTestcaseColumnValue(value, column, nextValue)
    }

    const currentColumnValue = getTestcaseColumnValue(value, column)
    const nextColumnValue = setValueAtPath(
        normalizeObjectValue(currentColumnValue),
        path.slice(1) as DataPath,
        nextValue,
    )

    return setTestcaseColumnValue(value, column, nextColumnValue)
}
