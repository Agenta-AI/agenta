/**
 * Utility functions for building scenario-level metric data from annotation values.
 *
 * This module provides functions to convert annotation values into the correct
 * metric shape expected by the API. The metric shape varies based on the value type:
 *
 * - `binary`: For boolean values with frequency distribution
 * - `categorical/multiple`: For array values with frequency distribution
 * - `string`: For string values (no distribution needed)
 * - `numeric/continuous`: For numeric values (simplified for scenario-level)
 */

export interface MetricFrequencyEntry {
    value: string | boolean | number
    count: number
    density: number
}

export interface BinaryMetricData {
    type: "binary"
    count: number
    freq: MetricFrequencyEntry[]
    uniq: boolean[]
}

export interface CategoricalMultipleMetricData {
    type: "categorical/multiple"
    count: number
    freq: MetricFrequencyEntry[]
    uniq: string[]
}

export interface StringMetricData {
    type: "string"
    count: number
}

export interface NumericMetricData {
    type: "numeric/continuous"
    count: number
    max: number
    min: number
    sum: number
    mean: number
    range: number
}

export type ScenarioMetricData =
    | BinaryMetricData
    | CategoricalMultipleMetricData
    | StringMetricData
    | NumericMetricData

/**
 * Build a binary metric data object from a boolean value.
 */
export const buildBinaryMetricData = (value: boolean): BinaryMetricData => ({
    type: "binary",
    count: 1,
    freq: [
        {value: true, count: value ? 1 : 0, density: value ? 1 : 0},
        {value: false, count: value ? 0 : 1, density: value ? 0 : 1},
    ],
    uniq: [true, false],
})

/**
 * Build a categorical/multiple metric data object from an array of values.
 */
export const buildCategoricalMultipleMetricData = (
    values: string[],
): CategoricalMultipleMetricData => {
    const uniqueValues = [...new Set(values)]
    const freq = uniqueValues.map((v) => {
        const count = values.filter((val) => val === v).length
        return {
            value: v,
            count,
            density: values.length > 0 ? count / values.length : 0,
        }
    })

    return {
        type: "categorical/multiple",
        count: 1,
        freq,
        uniq: uniqueValues,
    }
}

/**
 * Build a string metric data object.
 */
export const buildStringMetricData = (): StringMetricData => ({
    type: "string",
    count: 1,
})

/**
 * Build a numeric metric data object from a numeric value.
 * For scenario-level metrics, we use simplified stats (single value).
 */
export const buildNumericMetricData = (value: number): NumericMetricData => ({
    type: "numeric/continuous",
    count: 1,
    max: value,
    min: value,
    sum: value,
    mean: value,
    range: 0,
})

/**
 * Infer the metric type from a value.
 */
export const inferMetricType = (
    value: unknown,
): "binary" | "categorical/multiple" | "string" | "numeric/continuous" | null => {
    if (typeof value === "boolean") return "binary"
    if (Array.isArray(value)) return "categorical/multiple"
    if (typeof value === "string") return "string"
    if (typeof value === "number" && Number.isFinite(value)) return "numeric/continuous"
    return null
}

/**
 * Build the appropriate metric data object based on the value type.
 */
export const buildMetricDataFromValue = (value: unknown): ScenarioMetricData | null => {
    const metricType = inferMetricType(value)

    switch (metricType) {
        case "binary":
            return buildBinaryMetricData(value as boolean)
        case "categorical/multiple":
            return buildCategoricalMultipleMetricData(value as string[])
        case "string":
            return buildStringMetricData()
        case "numeric/continuous":
            return buildNumericMetricData(value as number)
        default:
            return null
    }
}

/**
 * Build the metric key path for an annotation output.
 * Format: `attributes.ag.data.outputs.<metricName>`
 */
export const buildMetricKeyPath = (metricName: string): string =>
    `attributes.ag.data.outputs.${metricName}`

/**
 * Build the step key for an annotation.
 * Format: `<invocationStepKey>.<evaluatorSlug>`
 */
export const buildAnnotationStepKey = (invocationStepKey: string, evaluatorSlug: string): string =>
    `${invocationStepKey}.${evaluatorSlug}`

export interface AnnotationMetricEntry {
    stepKey: string
    metricKey: string
    data: ScenarioMetricData
}

/**
 * Build scenario metric data from annotation outputs.
 *
 * @param outputs - The annotation outputs (e.g., {isAwesome: true, freeString: "test"})
 * @param invocationStepKey - The step key of the invocation (e.g., "default-0fb2277f006c")
 * @param evaluatorSlug - The evaluator slug (e.g., "new-human")
 * @returns An object with stepKey as key and metric data as value
 */
export const buildScenarioMetricDataFromAnnotation = ({
    outputs,
    invocationStepKey,
    evaluatorSlug,
}: {
    outputs: Record<string, unknown>
    invocationStepKey: string
    evaluatorSlug: string
}): Record<string, Record<string, ScenarioMetricData>> => {
    if (!outputs || typeof outputs !== "object") return {}

    const stepKey = buildAnnotationStepKey(invocationStepKey, evaluatorSlug)
    const metricsForStep: Record<string, ScenarioMetricData> = {}

    for (const [metricName, value] of Object.entries(outputs)) {
        // Skip null/undefined values
        if (value === null || value === undefined) continue

        const metricData = buildMetricDataFromValue(value)
        if (!metricData) continue

        const metricKey = buildMetricKeyPath(metricName)
        metricsForStep[metricKey] = metricData
    }

    if (Object.keys(metricsForStep).length === 0) return {}

    return {[stepKey]: metricsForStep}
}

/**
 * Merge new annotation metric data into existing scenario metric data.
 *
 * @param existingData - The existing metric data for the scenario
 * @param newData - The new metric data from the annotation
 * @returns The merged metric data
 */
export const mergeScenarioMetricData = (
    existingData: Record<string, Record<string, unknown>> | null | undefined,
    newData: Record<string, Record<string, ScenarioMetricData>>,
): Record<string, Record<string, unknown>> => {
    const result: Record<string, Record<string, unknown>> = {...(existingData || {})}

    for (const [stepKey, metrics] of Object.entries(newData)) {
        if (!result[stepKey]) {
            result[stepKey] = {}
        }
        for (const [metricKey, metricData] of Object.entries(metrics)) {
            result[stepKey][metricKey] = metricData
        }
    }

    return result
}
