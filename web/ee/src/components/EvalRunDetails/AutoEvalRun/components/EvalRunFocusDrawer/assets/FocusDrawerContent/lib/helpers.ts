import {UseEvaluationRunScenarioStepsFetcherResult} from "@/oss/lib/hooks/useEvaluationRunScenarioSteps/types"
import {DrawerEvaluatorMetric, DrawerMetricValueCellProps} from ".."
import {canonicalizeMetricKey} from "@/oss/lib/metricUtils"
import {getMetricsFromEvaluator} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"

export const SCENARIO_METRIC_ALIASES: Record<string, string[]> = {
    "attributes.ag.metrics.costs.cumulative.total": ["totalCost", "costs.total", "cost"],
    "attributes.ag.metrics.duration.cumulative": ["duration.total", "duration"],
    "attributes.ag.metrics.tokens.cumulative.total": ["totalTokens", "tokens.total", "tokens"],
    "attributes.ag.metrics.errors.cumulative": ["errors"],
    totalCost: ["attributes.ag.metrics.costs.cumulative.total", "costs.total", "cost"],
    "duration.total": ["attributes.ag.metrics.duration.cumulative", "duration"],
    totalTokens: ["attributes.ag.metrics.tokens.cumulative.total", "tokens.total", "tokens"],
    promptTokens: ["attributes.ag.metrics.tokens.cumulative.total", "tokens", "tokens.prompt"],
    completionTokens: [
        "attributes.ag.metrics.tokens.cumulative.total",
        "tokens",
        "tokens.completion",
    ],
    errors: ["attributes.ag.metrics.errors.cumulative"],
}

export const asEvaluatorArray = (input: any): any[] => {
    if (!input) return []
    if (Array.isArray(input)) return input
    if (typeof input === "object") return Object.values(input)
    return []
}

export const pickString = (candidate: unknown): string | undefined => {
    if (typeof candidate === "string") {
        const trimmed = candidate.trim()
        if (trimmed.length > 0) return trimmed
    }
    return undefined
}

export const collectEvaluatorIdentifiers = (entry: any): string[] => {
    if (!entry || typeof entry !== "object") return []
    const ids = new Set<string>()
    ;[
        entry.slug,
        entry.id,
        entry.key,
        entry.uid,
        entry.evaluator_key,
        entry?.data?.slug,
        entry?.data?.id,
        entry?.data?.key,
        entry?.data?.evaluator_key,
        entry?.meta?.slug,
        entry?.meta?.id,
        entry?.meta?.key,
        entry?.flags?.slug,
        entry?.flags?.id,
        entry?.flags?.key,
        entry?.flags?.evaluator_key,
        entry?.references?.slug,
        entry?.references?.id,
        entry?.references?.key,
    ].forEach((candidate) => {
        const value = pickString(candidate)
        if (value) ids.add(value)
    })
    return Array.from(ids)
}

export const extractEvaluatorSlug = (entry: any): string | undefined => {
    if (!entry || typeof entry !== "object") return undefined
    const candidates = collectEvaluatorIdentifiers(entry)
    if (candidates.length) return candidates[0]
    return undefined
}

export const extractEvaluatorName = (entry: any): string | undefined => {
    if (!entry || typeof entry !== "object") return undefined
    const candidates = [
        entry?.name,
        entry?.displayName,
        entry?.display_name,
        entry?.title,
        entry?.label,
        entry?.meta?.displayName,
        entry?.meta?.display_name,
        entry?.meta?.name,
        entry?.flags?.display_name,
        entry?.flags?.name,
        entry?.data?.display_name,
        entry?.data?.name,
    ]
    for (const candidate of candidates) {
        const value = pickString(candidate)
        if (value) return value
    }
    return undefined
}

export const asRecord = (value: any): Record<string, any> | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
    const entries = Object.entries(value)
    if (!entries.length) return undefined
    return value as Record<string, any>
}

export const extractSchemaProperties = (entry: any): Record<string, any> | undefined => {
    if (!entry || typeof entry !== "object") return undefined
    const candidates = [
        entry?.data?.schemas?.outputs?.properties,
        entry?.data?.schemas?.output?.properties,
        entry?.data?.service?.format?.properties?.outputs?.properties,
        entry?.data?.service?.properties?.outputs?.properties,
        entry?.data?.output_schema?.properties,
        entry?.data?.outputs_schema?.properties,
        entry?.output_schema?.properties,
        entry?.schema?.properties,
    ]
    for (const candidate of candidates) {
        const record = asRecord(candidate)
        if (record) return record
    }
    return undefined
}

export const resolveEvaluatorMetricsMap = (entry: any): Record<string, any> | undefined => {
    if (!entry || typeof entry !== "object") return undefined
    const direct = asRecord(entry.metrics)
    if (direct) return direct

    const schemaProps = extractSchemaProperties(entry)
    if (schemaProps) return schemaProps

    const derived = asRecord(getMetricsFromEvaluator(entry as any))
    if (derived) return derived

    return undefined
}

export const normalizeMetricPrimaryKey = (slug: string | undefined, rawKey: string): string => {
    const normalizedSlug = slug && slug.trim().length > 0 ? slug.trim() : undefined
    const trimmed = rawKey.trim()
    if (!trimmed) return normalizedSlug ?? ""
    if (normalizedSlug) {
        const prefix = `${normalizedSlug}.`
        if (trimmed.startsWith(prefix)) return trimmed
    }
    if (trimmed.includes(".")) return trimmed
    return normalizedSlug ? `${normalizedSlug}.${trimmed}` : trimmed
}

export const collectMetricFallbackKeys = (
    slug: string | undefined,
    rawKey: string,
    primaryKey: string,
    meta: any,
): string[] => {
    const set = new Set<string>()
    const normalizedSlug = slug && slug.trim().length > 0 ? slug.trim() : undefined
    const push = (value?: string) => {
        if (!value) return
        const trimmed = String(value).trim()
        if (!trimmed) return
        if (trimmed.includes(".") || !normalizedSlug) {
            set.add(trimmed)
        } else {
            set.add(`${normalizedSlug}.${trimmed}`)
        }
    }

    push(rawKey)

    const aliases = Array.isArray(meta?.aliases)
        ? meta?.aliases
        : meta?.aliases
          ? [meta.aliases]
          : meta?.alias
            ? [meta.alias]
            : []
    aliases.forEach(push)

    const extraKeys = [
        meta?.metricKey,
        meta?.metric_key,
        meta?.key,
        meta?.path,
        meta?.fullKey,
        meta?.full_key,
        meta?.canonicalKey,
        meta?.canonical_key,
        meta?.statsKey,
        meta?.stats_key,
        meta?.metric,
    ]
    extraKeys.forEach(push)

    const fallbackKeys = Array.from(set).filter((value) => value !== rawKey && value !== primaryKey)
    return fallbackKeys
}

export const stripOutputsPrefixes = (key: string): string => {
    let result = key
    const OUTPUT_PREFIX = "attributes.ag.data.outputs."
    const METRIC_PREFIX = "attributes.ag.metrics."
    while (result.startsWith(OUTPUT_PREFIX)) {
        result = result.slice(OUTPUT_PREFIX.length)
    }
    while (result.startsWith(METRIC_PREFIX)) {
        result = result.slice(METRIC_PREFIX.length)
    }
    return result
}

export const buildDrawerMetricDefinition = (
    slug: string | undefined,
    rawKey: string,
    meta: any,
): DrawerEvaluatorMetric => {
    const normalizedSlug = slug && slug.trim().length > 0 ? slug.trim() : undefined
    const normalizedDisplayBase =
        normalizedSlug && rawKey.startsWith(`${normalizedSlug}.`)
            ? rawKey.slice(normalizedSlug.length + 1)
            : rawKey
    const normalizedDisplay = stripOutputsPrefixes(normalizedDisplayBase)
    const primaryKey = normalizeMetricPrimaryKey(slug, rawKey)
    const fallbackKeys = collectMetricFallbackKeys(slug, rawKey, primaryKey, meta)
    const id = canonicalizeMetricKey(primaryKey) || primaryKey

    return {
        id,
        displayName: normalizedDisplay || primaryKey,
        metricKey: primaryKey,
        fallbackKeys: fallbackKeys.length ? fallbackKeys : undefined,
    }
}

export const collectCandidateSteps = (data?: UseEvaluationRunScenarioStepsFetcherResult): any[] => {
    if (!data) return []
    const buckets: any[] = []
    if (Array.isArray(data.annotationSteps)) buckets.push(...(data.annotationSteps as any[]))
    if (Array.isArray(data.steps)) buckets.push(...(data.steps as any[]))
    if (Array.isArray(data.invocationSteps)) buckets.push(...(data.invocationSteps as any[]))
    return buckets
}

export const collectSlugCandidates = (
    data: UseEvaluationRunScenarioStepsFetcherResult | undefined,
    evaluatorSlug: string,
): string[] => {
    const set = new Set<string>()
    const push = (value?: string | null) => {
        if (!value) return
        const normalized = String(value).trim()
        if (!normalized) return
        set.add(normalized)
    }

    push(evaluatorSlug)

    const steps = collectCandidateSteps(data)
    steps.forEach((step) => {
        if (!step) return
        const ref: any = step?.references?.evaluator
        push(step?.stepKey as any)
        push(step?.stepkey as any)
        push(step?.step_key as any)
        push(ref?.slug)
        push(ref?.key)
        push(ref?.id)
    })

    return Array.from(set)
}

export const findAnnotationStepKey = (
    data: UseEvaluationRunScenarioStepsFetcherResult | undefined,
    slugCandidates: string[],
): string | undefined => {
    if (!data) return undefined

    const steps = collectCandidateSteps(data)
    if (!steps.length) return undefined

    const loweredCandidates = slugCandidates
        .map((slug) => String(slug).toLowerCase())
        .filter((slug) => slug.length > 0)

    const matched = steps.find((step) => {
        if (!step) return false
        const possible: string[] = [
            (step as any)?.stepKey,
            (step as any)?.stepkey,
            (step as any)?.step_key,
            (step as any)?.references?.evaluator?.slug,
            (step as any)?.references?.evaluator?.key,
            (step as any)?.references?.evaluator?.id,
        ]

        return possible
            .filter(Boolean)
            .map((value) => String(value).toLowerCase())
            .some((candidate) => loweredCandidates.includes(candidate))
    })

    return (
        (matched as any)?.stepKey ??
        (matched as any)?.stepkey ??
        (matched as any)?.step_key ??
        undefined
    )
}

/** Return the best primitive/array value from annotationSteps[].annotation.data.outputs */
export const getFromAnnotationOutputs = ({
    scenarioStepsResult,
    slugCandidates,
    evaluatorSlug,
    expandedCandidates,
}: {
    scenarioStepsResult?: DrawerMetricValueCellProps["scenarioStepsResult"]
    slugCandidates: string[]
    evaluatorSlug: string
    expandedCandidates: string[]
}): {value: any; matchedKey?: string} | undefined => {
    const data = scenarioStepsResult?.data
    if (!data || !Array.isArray(data.annotationSteps)) return undefined

    // choose only annotation steps that belong to any of our slug candidates
    const pool = new Set(slugCandidates.map((s) => String(s).toLowerCase()))
    const steps = (data.annotationSteps as any[]).filter((s) => {
        const sk = s?.stepKey ?? s?.stepkey ?? s?.step_key
        const ref = s?.references?.evaluator
        const ids = [sk, ref?.slug, ref?.key, ref?.id]
            .filter(Boolean)
            .map((x) => String(x).toLowerCase())
        return ids.some((id) => pool.has(id))
    })

    if (!steps.length) return undefined

    // outputs pockets we’re allowed to read as fallback
    const outputsOf = (s: any) =>
        [s?.annotation?.data?.outputs, s?.data?.outputs, s?.outputs].filter(
            (o) => o && typeof o === "object",
        ) as Record<string, any>[]

    const isPrimitive = (v: unknown) =>
        v === null || ["string", "number", "boolean"].includes(typeof v)

    const stripPfx = (k: string) => {
        const PFX = [
            "attributes.ag.data.outputs.",
            "ag.data.outputs.",
            "outputs.",
            `${evaluatorSlug}.`,
        ]
        for (const p of PFX) if (k.startsWith(p)) return k.slice(p.length)
        return k
    }

    const pathGet = (obj: any, path: string) =>
        path.split(".").reduce((acc, k) => (acc == null ? acc : acc[k]), obj)

    // 1) exact/bare path tries inside outputs
    for (const s of steps) {
        for (const outs of outputsOf(s)) {
            for (const cand of expandedCandidates) {
                const bare = stripPfx(cand)
                for (const v of new Set<string>([stripPfx(cand), bare, `extra.${bare}`])) {
                    const val = pathGet(outs, v)
                    if (val !== undefined && (isPrimitive(val) || Array.isArray(val))) {
                        return {value: val, matchedKey: v}
                    }
                }
            }
        }
    }

    // 2) fuzzy DFS through outputs (skip schema objects like { type: ... })
    const canonical = (s?: string) =>
        typeof s === "string" ? s.toLowerCase().replace(/[^a-z0-9]+/g, "") : ""

    const terminals = new Set(
        expandedCandidates.map((k) => stripPfx(k).split(".").pop()!).map(canonical),
    )

    const looksLikeSchema = (o: any) =>
        o &&
        typeof o === "object" &&
        !Array.isArray(o) &&
        Object.keys(o).length <= 2 &&
        "type" in o &&
        (Object.keys(o).length === 1 || "description" in o)

    const dfs = (obj: any, path: string[] = []): {value: any; matchedKey: string} | undefined => {
        if (!obj || typeof obj !== "object") return
        for (const [k, v] of Object.entries(obj)) {
            const p = [...path, k]
            if (isPrimitive(v) || Array.isArray(v)) {
                const hit = terminals.has(canonical(k)) || terminals.has(canonical(p[p.length - 1]))
                if (hit) return {value: v, matchedKey: p.join(".")}
            } else if (!looksLikeSchema(v)) {
                const h = dfs(v, p)
                if (h) return h
            }
        }
    }

    for (const s of steps) {
        for (const outs of outputsOf(s)) {
            const hit = dfs(outs)
            if (hit) return hit
        }
    }

    return undefined
}
