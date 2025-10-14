import {UUID} from "uuidjs"

import {AnnotationDto} from "../types"

/**
 * Converts a UUID string to a trace ID by parsing it and returning its hexadecimal representation without delimiters.
 *
 * @param uuid - The UUID string to convert (e.g., '442d8202-a01b-fe43-f024-5be0780eae9f').
 * @returns The hexadecimal string representation of the UUID without dashes, or undefined if parsing fails.
 */
export const uuidToTraceId = (uuid?: string) => {
    if (!uuid) return undefined
    const parsed = UUID.parse(uuid)
    return parsed?.hexNoDelim
}

/**
 * Converts a UUID string to a span ID by extracting and concatenating the clock sequence and node fields from the parsed UUID.
 *
 * @param uuid - The UUID string to convert.
 * @returns The concatenated hexadecimal string of clock sequence and node fields, or undefined if parsing fails.
 */
export const uuidToSpanId = (uuid?: string) => {
    if (!uuid) return undefined
    const parsed = UUID.parse(uuid)
    return `${parsed?.hexFields.clockSeqHiAndReserved}${parsed?.hexFields.clockSeqLow}${parsed?.hexFields.node}`
}

/**
 * Generates a formatted span UUID string from an annotation object.
 *
 * Extracts the trace_id and span_id from the annotation's links.invocation property, formats the trace ID as 'xxxxxxxx-xxxx-xxxx',
 * and the span ID as 'xxxx-xxxxxxxxxxxx'. Returns the combined string in the format:
 *   'f0245be0-780e-ae9f-33f1-ff4651d9375e'
 *
 * @param annotation - The AnnotationDto object containing the trace and span IDs.
 * @returns The formatted span UUID string.
 */
export const spanUuidFromAnnotation = (annotation: AnnotationDto) => {
    const annotationSpanId = annotation.links?.invocation?.span_id
    // "33f1ff4651d9375a" to "33f1-ff4651d9375e"
    const spanUuidPart = `${annotationSpanId?.slice(0, 4)}-${annotationSpanId?.slice(4)}`

    function splitId(id: string): string {
        // Take the last 16 characters as the "interesting" part
        const last16 = id.slice(-16)
        const part1 = last16.slice(0, 8)
        const part2 = last16.slice(8, 12)
        const part3 = last16.slice(12, 16)
        // If the ID is shorter than expected, handle gracefully
        return [part1, part2, part3].filter(Boolean).join("-")
    }

    // turn an id like 442d8202a01bfe43f0245be0780eae9f into 3 parts such as f0245be0-780e-ae9f
    const annotationTraceId = annotation.links?.invocation?.trace_id
    const tracePart = splitId(annotationTraceId || "")

    return `${tracePart}-${spanUuidPart}`
}

export const groupOutputValues = (outputs: Record<string, any>): Record<string, any> => {
    const grouped: Record<string, any> = {
        metrics: {},
        notes: {},
        extra: {}, // we need the other data type info to add those in the endpoint when updating annotations
    }

    function recurse(obj: Record<string, any>) {
        for (const [key, value] of Object.entries(obj)) {
            if (value === null) continue

            if (typeof value === "number" || typeof value === "boolean") {
                grouped.metrics[key] = value
            } else if (typeof value === "string") {
                grouped.notes[key] = value
            } else {
                grouped.extra[key] = value
            }
        }
    }

    recurse(outputs)
    return grouped
}

/**
 * Groups annotations by evaluator slug and aggregates their metric values.
 *
 * For each annotation, this function groups metrics by the evaluator slug name and metric name.
 * Then, based on the value type of the metric:
 *   - If the values are all numbers, it calculates the average.
 *   - If the values are all booleans, it takes the latest (last) boolean value.
 *
 * Only metrics with number or boolean values are considered. Each metric record also retains the
 * original annotation values along with the user who created them.
 *
 * @param annotations - The list of annotation objects to process.
 * @returns An object where keys are evaluator slug names, and values are objects mapping each
 *          metric name to either:
 *            - { average, annotations } for number metrics
 *            - { latest, annotations } for boolean metrics
 */
export const groupAnnotationsByReferenceId = (
    annotations: AnnotationDto[],
): Record<string, Record<string, {average?: number; latest?: boolean; annotations: any[]}>> => {
    const grouped: Record<
        string,
        Record<string, {values: {value: number | boolean; user: string}[]}>
    > = {}

    for (const annotation of annotations) {
        const evaluatorSlot = annotation.references?.evaluator?.slug
        if (!evaluatorSlot) continue

        if (!grouped[evaluatorSlot]) {
            grouped[evaluatorSlot] = {}
        }

        const metrics = annotation.data?.outputs?.metrics || {}
        for (const [metricName, value] of Object.entries(metrics)) {
            if (typeof value !== "number" && typeof value !== "boolean") continue

            if (!grouped[evaluatorSlot][metricName]) {
                grouped[evaluatorSlot][metricName] = {values: []}
            }

            grouped[evaluatorSlot][metricName].values.push({
                value,
                user: annotation.createdBy || "",
            })
        }
    }

    // Final processing
    const result: Record<
        string,
        Record<string, {average?: number; latest?: boolean; annotations: any[]}>
    > = {}

    for (const [evaluatorSlot, metricsGroup] of Object.entries(grouped)) {
        result[evaluatorSlot] = {}

        for (const [metricName, metricData] of Object.entries(metricsGroup)) {
            const {values} = metricData
            const allNumbers = values.every((v) => typeof v.value === "number")
            const allBooleans = values.every((v) => typeof v.value === "boolean")

            if (allNumbers || allBooleans) {
                // Handle both numbers and booleans the same way
                const total = values.reduce(
                    (sum, v) => sum + (typeof v.value === "boolean" ? (v.value ? 1 : 0) : v.value),
                    0,
                )
                const average = total / values.length
                result[evaluatorSlot][metricName] = {
                    average: parseFloat(average.toFixed(2)),
                    annotations: values,
                }
            } else {
                // mixed or unsupported types — skip or log
                continue
            }
        }
    }

    return result
}

export function attachAnnotationsToTraces(traces: any[], annotations: AnnotationDto[] = []) {
    function attach(trace: any): any {
        const invocationIds = trace.invocationIds

        const matchingAnnotations = annotations.filter((annotation: AnnotationDto) => {
            // Check if annotation links to this trace via ANY link key (including "invocation" and dynamic keys like "test-xxx")
            if (annotation.links && typeof annotation.links === "object") {
                const linkValues = Object.values(annotation.links)
                return linkValues.some(
                    (link: any) =>
                        link?.trace_id === (invocationIds?.trace_id || "") &&
                        link?.span_id === (invocationIds?.span_id || ""),
                )
            }
            return false
        })

        return {
            ...trace,
            annotations: matchingAnnotations,
            aggregatedEvaluatorMetrics: groupAnnotationsByReferenceId(matchingAnnotations),
            children: trace.children?.map(attach),
        }
    }
    return traces.map(attach)
}
