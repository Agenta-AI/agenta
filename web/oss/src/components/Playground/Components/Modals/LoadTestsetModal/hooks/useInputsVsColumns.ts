import {useMemo} from "react"

import {TestSet} from "@/oss/lib/Types"

export interface InputsVsColumnsResult {
    availableCsvColumns: string[]
    csvColumnMap: Map<string, string>
    matchingVariables: string[]
    missingExpectedVariables: string[]
    unexpectedCsvColumns: string[]
    datasetLoaded: boolean
    shouldBlockLoad: boolean
    matchingVariableSet: Set<string>
    hasCompatibilityIssue: boolean
    disabledReason?: string
}

/**
 * Reusable hook to compare required input variables against available CSV columns
 * and provide derived helpers for UI state and messaging.
 */
export function useInputsVsColumns(
    expectedInputVariables: string[],
    testsetCsvData: TestSet["csvdata"],
): InputsVsColumnsResult {
    const availableCsvColumns = useMemo(() => {
        if (!testsetCsvData.length) return [] as string[]
        const firstRow = testsetCsvData[0] || ({} as Record<string, unknown>)
        return Object.keys(firstRow)
    }, [testsetCsvData])

    const csvColumnMap = useMemo(() => {
        return availableCsvColumns.reduce((acc, column) => {
            if (!column) return acc
            const trimmed = String(column).trim()
            if (!trimmed) return acc
            if (!acc.has(trimmed)) {
                acc.set(trimmed, trimmed)
            }
            return acc
        }, new Map<string, string>())
    }, [availableCsvColumns])

    const matchingVariables = useMemo(
        () =>
            expectedInputVariables.filter((variable) => {
                if (typeof variable !== "string") return false
                const trimmed = variable.trim()
                if (!trimmed) return false
                return csvColumnMap.has(trimmed)
            }),
        [csvColumnMap, expectedInputVariables],
    )

    const missingExpectedVariables = useMemo(
        () =>
            expectedInputVariables.filter((variable) => {
                if (typeof variable !== "string") return false
                const trimmed = variable.trim()
                if (!trimmed) return false
                return !csvColumnMap.has(trimmed)
            }),
        [csvColumnMap, expectedInputVariables],
    )

    const unexpectedCsvColumns = useMemo(() => {
        if (!availableCsvColumns.length) return []
        const expectedSet = new Set(
            expectedInputVariables
                .map((variable) =>
                    typeof variable === "string" ? variable.trim().toLowerCase() : "",
                )
                .filter(Boolean),
        )
        if (!expectedSet.size) return []
        return availableCsvColumns.filter((column) => {
            const trimmed = typeof column === "string" ? column.trim().toLowerCase() : ""
            if (!trimmed) return false
            return !expectedSet.has(trimmed)
        })
    }, [availableCsvColumns, expectedInputVariables])

    const datasetLoaded = testsetCsvData.length > 0

    const shouldBlockLoad =
        datasetLoaded && expectedInputVariables.length > 0 && matchingVariables.length === 0

    const hasCompatibilityIssue = datasetLoaded && missingExpectedVariables.length > 0

    const matchingVariableSet = useMemo(() => new Set(matchingVariables), [matchingVariables])

    const disabledReason = useMemo(() => {
        if (!hasCompatibilityIssue) return undefined
        if (!expectedInputVariables.length) return undefined
        if (!missingExpectedVariables.length) return undefined
        return `Variant inputs missing in test set: ${missingExpectedVariables.join(", ")}`
    }, [expectedInputVariables.length, hasCompatibilityIssue, missingExpectedVariables])

    return {
        availableCsvColumns,
        csvColumnMap,
        matchingVariables,
        missingExpectedVariables,
        unexpectedCsvColumns,
        datasetLoaded,
        shouldBlockLoad,
        matchingVariableSet,
        hasCompatibilityIssue,
        disabledReason,
    }
}
