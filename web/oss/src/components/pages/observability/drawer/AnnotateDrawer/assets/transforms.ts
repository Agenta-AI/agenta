import deepEqual from "fast-deep-equal"

import {AnnotationDto, AnnotationEditPayloadDto} from "@/oss/lib/hooks/useAnnotations/types"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"

import {NUMERIC_METRIC_TYPES, USEABLE_METRIC_TYPES} from "./constants"
import {MetricFormData} from "./CreateEvaluator/assets/types"
import {UpdatedMetricsType, UpdatedMetricType} from "./types"

/**
 * The way the defensive console.log() is working is by having:
 * 1. A unique key first to search on the browser console
 * 2. Name of the function to know where the console.log() is coming from
 * 3. The data itself
 */

// 1. we call either getInitialMetricsFromAnnotations() or getInitialSelectedEvalMetrics() which is using getDefaultValue()
// 2. we call transformMetadata()
// 3. we call generateAnnotationPayload() or generateSelectedEvalMetricsPayload() which is using payloadSchemaSanitizer() and getDefaultValue()

const getPropertyType = (type: string | string[]): string => {
    if (type === "integer") return "number"
    if (type === "array" || Array.isArray(type)) return "string"
    return type as string
}

export const transformMetadata = ({
    data,
    disabled,
}: {
    data: Record<string, any>
    disabled?: boolean
}) => {
    if (typeof data !== "object" || !Object.keys(data || {}).length) {
        console.log("ANNOTATE, transformMetadata: No data found")
        return []
    }

    const entries = Object.entries(data || {})

    const metadata = entries.map(([key, property]) => {
        const type = getPropertyType(property.type)
        const metadataItem: Record<string, any> = {
            type,
            disabled,
            originalType: property.type,
            title: key,
            value: property.value,
            placeholder: "Enter value",
            allowClear: true,
            disableClear:
                property.value == null || property.value === undefined || property.value === "",
        }

        if (NUMERIC_METRIC_TYPES.includes(type)) {
            metadataItem.min = property.minimum
            metadataItem.max = property.maximum
            metadataItem.isInteger = property.type === "integer"
            metadataItem.placeholder = type
        }

        if (type === "string") {
            metadataItem.as = "SimpleInputWithLabel"
        }

        if (property.type === "boolean") {
            metadataItem.as = "GroupTab"
            metadataItem.options = [
                {label: "True", value: true},
                {label: "False", value: false},
            ]
        }

        if (property.type === "array" && property.items?.enum) {
            metadataItem.mode = "tags"
            metadataItem.options = property.items.enum.map((item: string) => ({
                label: item,
                value: item,
            }))
        }
        if (Array.isArray(property.type) && property.enum) {
            metadataItem.options = property.enum.map((item: string) => ({
                ...(item === null
                    ? {
                          className:
                              "relative before:content-[''] before:block before:absolute before:-top-1.5 before:left-0 before:right-0 before:border-[0.5px] before:border-t before:border-solid before:border-gray-100 mt-3",
                      }
                    : {}),
                label: item === null ? "non of the above" : String(item),
                value: String(item),
            }))
        }

        return metadataItem
    })

    return metadata.sort((a, b) => {
        const typePriority = (type: string) => {
            if (NUMERIC_METRIC_TYPES.includes(type)) return 1
            if (type === "boolean") return 2
            if (type === "string") return 3
            return 0
        }
        return typePriority(a.originalType) - typePriority(b.originalType)
    })
}

export const getInitialMetricsFromAnnotations = ({
    annotations,
    evaluators,
}: {
    annotations: AnnotationDto[]
    evaluators: EvaluatorDto[]
}): UpdatedMetricsType => {
    if (!annotations?.length || !evaluators.length) {
        console.log(
            "ANNOTATE, getInitialMetricsFromAnnotations: both annotations and evaluators are required",
        )
        return {}
    }

    const metrics: UpdatedMetricsType = {}

    for (const ann of annotations) {
        const annEvalSlug = ann.references?.evaluator?.slug
        if (!annEvalSlug) continue

        const evaluator = evaluators.find((e) => e.slug === annEvalSlug)
        if (!evaluator) continue

        const evalMetricsSchema =
            evaluator.data?.service?.format?.properties?.outputs?.properties || {}

        const useableMetrics = Object.entries(evalMetricsSchema).filter(
            ([_, prop]) => USEABLE_METRIC_TYPES.includes(prop.type) || Array.isArray(prop?.anyOf),
        )

        const outputs = (ann.data?.outputs as Record<string, any>) || {}
        const allAnnMetrics = {...outputs.metrics, ...outputs.notes, ...outputs.extra}

        const fields: Record<string, UpdatedMetricType> = {}

        for (const [key, prop] of useableMetrics) {
            if (key in allAnnMetrics) {
                // If key exists in annotations, use its value
                if (prop?.anyOf?.length > 0) {
                    const props = prop.anyOf[0]
                    fields[key] = {value: allAnnMetrics[key], ...props}
                } else if (prop.type === "array") {
                    const {value, items, ...restProps} = prop
                    fields[key] = {
                        value: allAnnMetrics[key] === undefined ? [] : allAnnMetrics[key],
                        items: {
                            type: items?.type === "string" ? items?.type : "string",
                            enum: items?.enum || [],
                        },
                        ...restProps,
                    }
                } else {
                    const {value: _value, ...restProps} = prop
                    fields[key] = {value: allAnnMetrics[key], ...restProps}
                }
            } else {
                // Key doesn't exist in annotations, use default value
                const props = prop.anyOf?.[0] || prop
                const defaultVal = getDefaultValue({property: props, ignoreObject: true})
                fields[key] = {value: defaultVal, ...props}
            }
        }

        metrics[annEvalSlug] = fields
    }

    return metrics
}

export const getInitialSelectedEvalMetrics = ({
    evaluators,
    selectedEvaluators,
}: {
    evaluators: EvaluatorDto[]
    selectedEvaluators: string[]
}) => {
    if (!selectedEvaluators?.length || !evaluators?.length) {
        console.log(
            "ANNOTATE, getInitialSelectedEvalMetrics: both evaluators and selectedEvaluators are required",
        )
        return {}
    }

    const _evaluators = evaluators?.filter((e) => selectedEvaluators.includes(e.slug))

    if (!_evaluators?.length) return {}

    const metrics: Record<string, any> = {}

    _evaluators.forEach((evaluator) => {
        const evalMetricsSchema =
            evaluator.data?.service?.format?.properties?.outputs?.properties ?? {}
        const fields: Record<string, any> = {}

        for (const [key, prop] of Object.entries(evalMetricsSchema)) {
            if (prop.anyOf?.length > 0) {
                const props = prop.anyOf[0]
                fields[key] = {value: "", ...props}
            } else if (prop.type === "array") {
                const {value, items, ...restProps} = prop
                fields[key] = {
                    value: "",
                    items: {
                        type: items?.type === "string" ? items?.type : "string",
                        enum: items?.enum || [],
                    },
                    ...restProps,
                }
            } else if (prop.type && USEABLE_METRIC_TYPES.includes(prop.type)) {
                const {value, ...restProps} = prop
                fields[key] = {
                    value: getDefaultValue({property: prop, ignoreObject: true}),
                    ...restProps,
                }
            }
        }

        metrics[evaluator.slug] = fields
    })

    return metrics
}

export const generateAnnotationPayloadData = ({
    annotations,
    updatedMetrics,
    evaluators,
}: {
    annotations: AnnotationDto[]
    updatedMetrics: Record<string, Record<string, any>>
    evaluators: EvaluatorDto[]
}): {
    payload: AnnotationEditPayloadDto[]
    requiredMetrics: Record<string, {value: any; type: string}>
} => {
    if (!annotations?.length || !Object.keys(updatedMetrics || {}).length) {
        console.log(
            "ANNOTATE, generateAnnotationPayload: both annotations and updatedMetrics are required",
        )
        return {payload: [], requiredMetrics: {}}
    }

    const evaluatorMap: Record<string, EvaluatorDto> = {}
    for (const e of evaluators) {
        evaluatorMap[e.slug] = e
    }

    const payload: AnnotationEditPayloadDto[] = []
    const requiredMetrics: Record<string, {value: any; type: string}> = {}

    for (const ann of annotations) {
        const slug = ann.references?.evaluator?.slug || ""
        const updatedMetric = updatedMetrics[slug]
        if (!updatedMetric || !Object.keys(updatedMetric).length) {
            continue
        }

        const evaluator = evaluatorMap[slug]
        if (!evaluator) continue

        const outputs = (ann.data?.outputs as Record<string, any>) || {}
        const originalMetric = {...outputs.metrics, ...outputs.notes, ...outputs.extra}

        const requiredMetricKeys = evaluator.data.service.format.properties.outputs.required ?? []

        const metrics: Record<string, any> = {}
        const _requiredMetrics: Record<string, {value: any; type: string}> = {}

        for (const key of Object.keys(updatedMetric)) {
            const property = updatedMetric[key]
            const value = property.value

            const isEmpty = value === "" || value === null || value === undefined
            const isRequired = requiredMetricKeys.includes(key)

            if (isEmpty) {
                if (isRequired) {
                    _requiredMetrics[key] = {
                        value,
                        type: property.type || property.anyOf?.[0]?.type,
                    }
                }
                // skip storing optional empties
            } else {
                metrics[key] = value
            }

            if (value === "null") {
                metrics[key] = null
            }
        }

        // If any required missing, collect to global and skip payload
        if (Object.keys(_requiredMetrics).length) {
            for (const [k, v] of Object.entries(_requiredMetrics)) {
                requiredMetrics[k] = v
            }
            continue
        }

        // Skip if nothing changed
        if (deepEqual(originalMetric, metrics)) {
            continue
        }

        payload.push({
            annotation: {
                data: {
                    ...ann.data,
                    outputs: metrics,
                },
                meta: {...(ann.meta as any)},
            },
            trace_id: ann.trace_id,
            span_id: ann.span_id,
        })
    }

    return {payload, requiredMetrics}
}

export const generateNewAnnotationPayloadData = ({
    updatedMetrics,
    selectedEvaluators,
    evaluators,
    traceSpanIds,
}: {
    updatedMetrics: Record<string, Record<string, any>>
    selectedEvaluators: string[]
    evaluators: EvaluatorDto[]
    traceSpanIds: {traceId: string; spanId: string}
}): {
    payload: any[]
    requiredMetrics: Record<string, {value: any; type: string}>
} => {
    if (!evaluators?.length || !selectedEvaluators?.length || !updatedMetrics || !traceSpanIds) {
        console.log(
            "ANNOTATE, generateNewAnnotationPayloadData: both evaluators, selectedEvaluators and updatedMetrics are required",
        )
        return {payload: [], requiredMetrics: {}}
    }

    const payload: any[] = []
    const requiredMetrics: Record<string, {value: any; type: string}> = {}

    for (const evaluator of evaluators) {
        if (!selectedEvaluators.includes(evaluator.slug)) continue

        const updatedMetric = updatedMetrics[evaluator.slug || ""]
        if (!updatedMetric || Object.keys(updatedMetric).length === 0) continue

        const schemaProps = evaluator.data.service.format.properties.outputs.properties ?? {}
        const requiredKeys = evaluator.data.service.format.properties.outputs.required ?? []

        const metrics: Record<string, any> = {}
        const defaultMetric: Record<string, any> = {}
        const localRequiredMetrics: Record<string, {value: any; type: string}> = {}

        // convert updated metric into a structured metric (e.g eval-name: {value: 1, type: "integer"} to eval-name: 1)
        for (const [key, property] of Object.entries(updatedMetric)) {
            metrics[key] = property.value
        }

        for (const [key, schemaProp] of Object.entries(schemaProps)) {
            const defaultValue = getDefaultValue({property: schemaProp})
            const value = metrics[key]
            const isEmpty = value === "" || value === null || value === undefined
            const isRequired = requiredKeys.includes(key)

            if (!(key in metrics)) {
                metrics[key] = defaultValue
            }

            if (isRequired && isEmpty) {
                localRequiredMetrics[key] = {
                    value: defaultValue,
                    type: schemaProp?.type || schemaProp?.anyOf?.[0]?.type,
                }
            }

            defaultMetric[key] =
                schemaProp.type === "array" || Array.isArray(schemaProp?.anyOf) ? "" : defaultValue
        }

        // Skip if all metrics are default (i.e. not annotated yet)
        if (deepEqual(defaultMetric, metrics)) continue

        // Skip payload and accumulate required metrics if any are missing
        if (Object.keys(localRequiredMetrics).length > 0) {
            Object.assign(requiredMetrics, localRequiredMetrics)
            continue
        }

        const sanitizedMetric = payloadSchemaSanitizer({
            schema: schemaProps,
            data: metrics,
        })

        // Remove optional empty fields
        for (const key of Object.keys(sanitizedMetric)) {
            const isRequired = requiredKeys.includes(key)
            const isEmpty = !sanitizedMetric[key] && sanitizedMetric[key] !== false

            if (!isRequired && isEmpty) {
                delete sanitizedMetric[key]
            }
        }

        // converting string "null" into actual null for class metric / changes for class
        for (const [key, property] of Object.entries(sanitizedMetric)) {
            if (property === "null") {
                sanitizedMetric[key] = null
            }
        }

        const payloadEntry = {
            annotation: {
                data: {outputs: sanitizedMetric},
                references: {
                    evaluator: {
                        slug: evaluator.slug,
                    },
                },
                origin: "human",
                kind: "adhoc",
                channel: "web",
                meta: {
                    name: evaluator.name || "",
                    description: evaluator.description || "",
                    tags: requiredKeys,
                },
                links: {
                    invocation: {
                        trace_id: traceSpanIds.traceId,
                        span_id: traceSpanIds.spanId,
                    },
                },
            },
        }

        payload.push(payloadEntry)
    }

    return {payload, requiredMetrics}
}

export const generateNewEvaluatorPayloadData = ({
    metrics,
    evaluatorName,
    evaluatorSlug,
    evaluatorDescription,
}: {
    metrics: MetricFormData[]
    evaluatorName: string
    evaluatorSlug: string
    evaluatorDescription: string
}) => {
    if (!metrics?.length || !evaluatorName || !evaluatorSlug) {
        console.log(
            "ANNOTATE, generateNewEvaluatorPayloadData: both metrics, evaluatorName and evaluatorSlug are required",
        )
        return {}
    }

    const requiredKeys = metrics.filter((metric) => !metric.optional).map((metric) => metric.name)

    const properties = metrics.reduce(
        (acc, metric) => {
            acc[metric.name] = Object.entries(metric).reduce(
                (metricAcc, [key, value]) => {
                    const isValidKey = key !== "optional" && key !== "name"
                    if (isValidKey && value !== undefined && value !== null) {
                        metricAcc[key] = value
                    }
                    return metricAcc
                },
                {} as Record<string, any>,
            )

            if (acc[metric.name].type === "label") {
                acc[metric.name] = {
                    type: "array",
                    uniqueItems: true,
                    items: {
                        type: "string",
                        enum: acc[metric.name].enum?.filter(Boolean) || [],
                    },
                }
            }

            if (acc[metric.name].type === "class") {
                acc[metric.name] = {
                    anyOf: [
                        {
                            type: ["string", "null"],
                            enum: [...(acc[metric.name].enum?.filter(Boolean) || []), null],
                        },
                    ],
                }
            }
            return acc
        },
        {} as Record<string, any>,
    )

    return {
        evaluator: {
            slug: evaluatorSlug,
            name: evaluatorName,
            description: evaluatorDescription || "",
            meta: {
                tag1: "tag1",
                tag2: "tag2",
            },
            flags: {
                is_custom: false,
                is_human: true,
            },
            data: {
                service: {
                    agenta: "v0.1.0",
                    format: {
                        type: "object",
                        $schema: "http://json-schema.org/schema#",
                        required: ["outputs"],
                        properties: {
                            outputs: {
                                type: "object",
                                properties,
                                required: requiredKeys,
                            },
                        },
                    },
                },
            },
        },
    }
}

export function getDefaultValue({
    property,
    ignoreObject = false,
}: {
    property: any
    ignoreObject?: boolean
}): any {
    if (typeof property !== "object" || !Object.keys(property || {}).length) {
        console.log("ANNOTATE, getDefaultValue: property.type is required")
        return
    }

    switch (property.type) {
        case "boolean":
            return null
        case "integer":
            return null
        case "float":
            return null
        case "number":
            return null
        case "string":
            return ""
        case "object":
            if (ignoreObject) break
            const obj: Record<string, any> = {}
            if (property.properties) {
                for (const [k, v] of Object.entries(property.properties)) {
                    obj[k] = getDefaultValue({property: v, ignoreObject})
                }
            }
            return obj
        case "array":
            if (property.items && property.items.type && property.items.type !== "string") {
                return [getDefaultValue({property: property.items, ignoreObject})]
            }
            break
        default:
            if (ignoreObject) break
            return
    }
}

/**
 * Recursively sanitizes a data object according to a JSON-like schema.
 * Ensures that all values in the data conform to their schema-defined types,
 * and fills in missing or null values with schema defaults.
 * It only works for objects and arrays ans string.
 * Avoiding number and boolean types as can have null values.
 *
 * @param schema - The schema definition for the data object.
 * @param data - The data object to sanitize.
 * @returns A sanitized copy of the data object, matching the schema types and defaults.
 */
export const payloadSchemaSanitizer = ({
    schema,
    data,
}: {
    schema: Record<string, any>
    data: Record<string, any>
}) => {
    if (!Object.keys(schema || {}).length || !Object.keys(data || {}).length) {
        console.log("ANNOTATE, payloadSchemaSanitizer: both schema and data are required")
        return {}
    }

    const sanitizedData: Record<string, any> = {}
    for (const key of Object.keys(schema)) {
        const property = schema[key]
        let value = data[key]
        switch (property.type) {
            case "string":
                sanitizedData[key] = value == null ? getDefaultValue({property}) : String(value)
                break
            case "array":
                if (Array.isArray(value)) {
                    sanitizedData[key] = value.map((item) => {
                        if (NUMERIC_METRIC_TYPES.includes(property.items?.type) && !item) {
                            return 0
                        }
                        if (property.items?.type === "boolean" && !item) {
                            return false
                        }
                        if (
                            property.items &&
                            property.items.type &&
                            property.items.type !== "string"
                        ) {
                            return payloadSchemaSanitizer({schema: property.items, data: item})
                        }
                        return item
                    })
                } else {
                    sanitizedData[key] = value
                }
                break
            case "object": {
                const subSchema = property.properties || {}
                const subValue =
                    typeof value === "object" && value !== null && !Array.isArray(value)
                        ? value
                        : {}
                const sanitizedSubObj: Record<string, any> = {}
                for (const subKey of Object.keys(subSchema)) {
                    const subProperty = subSchema[subKey]
                    let subValueToUse = subValue[subKey]

                    if (NUMERIC_METRIC_TYPES.includes(subProperty?.type) && !subValueToUse) {
                        subValueToUse = 0
                    } else if (subProperty?.type === "boolean" && !subValueToUse) {
                        subValueToUse = false
                    }

                    sanitizedSubObj[subKey] = payloadSchemaSanitizer({
                        schema: {[subKey]: subProperty},
                        data: {[subKey]: subValueToUse},
                    })[subKey]
                }

                sanitizedData[key] = sanitizedSubObj
                break
            }
            default:
                sanitizedData[key] = value
        }
    }
    return sanitizedData
}
