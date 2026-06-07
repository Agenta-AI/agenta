import {resolveOutputSchemaProperties} from "@agenta/entities/workflow"

/**
 * As of checkpoint-2 (2025-05-23) only these metric types are surfaced.
 * Verbatim from `web/oss/src/components/SharedDrawers/AnnotateDrawer/assets/constants.ts`.
 */
const USEABLE_METRIC_TYPES = ["number", "integer", "float", "boolean", "string", "array", "class"]

interface SchemaNode {
    type?: string | string[]
    properties?: Record<string, unknown>
    anyOf?: SchemaNode[]
}

const getPropertyType = (type: string | string[]): string => {
    if (type === "integer") return "number"
    if (type === "array" || Array.isArray(type)) return "string"
    return type as string
}

/**
 * Extract the flat, dot-pathed list of metric keys an evaluator emits, derived
 * from its output schema. Nested objects flatten into `parent.child`; arrays and
 * useable-typed leaves are included.
 *
 * This is the KEY-ONLY equivalent of OSS `getMetricsFromEvaluator` (which returns
 * full field objects). `buildRunConfig` only needs the keys, to build evaluator
 * output mappings.
 *
 * PARITY NOTE for T5 (metric-extraction DRY consolidation): the entities
 * `workflow/core/evaluatorResolution.extractMetrics` does NOT flatten nested-object
 * or array metrics — it returns top-level properties only. Consolidating onto it
 * (decision #4) requires extending it to flatten the way this port does, otherwise
 * nested-metric evaluators would lose mapping columns (a behavior regression). This
 * module preserves current behavior until that parity work lands.
 */
export const extractEvaluatorMetricKeys = (evaluator: {
    data?: Record<string, unknown> | null
}): string[] => {
    const properties = resolveOutputSchemaProperties(evaluator.data) ?? {}
    const keys: string[] = []

    const collect = (schema: Record<string, unknown>, prefix?: string) => {
        Object.entries(schema || {}).forEach(([key, rawProp]) => {
            if (!rawProp || typeof rawProp !== "object") return

            const node = rawProp as SchemaNode
            const props: SchemaNode = node.anyOf?.length ? node.anyOf[0] : node
            const qualifiedKey = prefix ? `${prefix}.${key}` : key
            const type = props.type as string | undefined

            if (type === "object" && props.properties && typeof props.properties === "object") {
                collect(props.properties, qualifiedKey)
                return
            }

            if (type === "array") {
                keys.push(qualifiedKey)
                return
            }

            if (type && USEABLE_METRIC_TYPES.includes(getPropertyType(type))) {
                keys.push(qualifiedKey)
            }
        })
    }

    collect(properties)
    return keys
}
