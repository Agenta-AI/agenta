/**
 * Evaluator Resolution Utilities
 *
 * Pure functions for resolving evaluator references from evaluation run data
 * and extracting metric definitions from evaluator schemas.
 *
 * These utilities are used by the EvalRunDetails UI to map evaluator references
 * (artifact IDs, revision IDs, slugs) to resolved evaluator definitions with
 * their metric columns.
 *
 * @packageDocumentation
 */

import {resolveOutputSchemaProperties} from "./schema"

// ============================================================================
// TYPES
// ============================================================================

export interface EvaluatorRef {
    /** Workflow artifact ID */
    artifactId?: string
    /** Revision ID (if resolved by ensureEvaluatorRevisions) */
    revisionId?: string
    slug?: string
}

export interface MetricColumnDefinition {
    name: string
    kind: "metric"
    path: string
    stepKey: string
    metricType: string
    displayLabel?: string
    description?: string
}

export interface EvaluatorDefinition {
    id: string
    name: string
    slug?: string
    description?: string | null
    version?: number | string | null
    metrics: MetricColumnDefinition[]
    raw?: unknown
}

// ============================================================================
// HELPERS
// ============================================================================

const METRIC_TYPE_FALLBACK = "string"

const titleize = (value: string) =>
    value
        .replace(/[_\-.]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/\b\w/g, (char) => char.toUpperCase())

const sanitizeReferenceValue = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined

// ============================================================================
// REF EXTRACTION
// ============================================================================

/**
 * Extract evaluator refs from a step's references object.
 * Returns artifact ID (from `evaluator`), revision ID (from `evaluator_revision`),
 * and slug separately so we can pick the best molecule access path.
 */
export const extractEvaluatorRef = (rawRefs: Record<string, unknown>): EvaluatorRef => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic ref shapes from API
    const refs = rawRefs as Record<string, any>
    // Artifact-level ref (always present after API normalization)
    const evaluatorRef = refs.evaluator ?? refs.evaluator_ref ?? refs.evaluatorRef ?? null
    // Revision-level ref (present after ensureEvaluatorRevisions patches the run)
    const revisionRef =
        refs.evaluator_revision ?? refs.evaluatorRevision ?? refs.evaluator_revision_ref ?? null

    const artifactId = sanitizeReferenceValue(evaluatorRef?.id) as string | undefined
    const revisionId = sanitizeReferenceValue(revisionRef?.id) as string | undefined
    const slug =
        (sanitizeReferenceValue(evaluatorRef?.slug) as string | undefined) ??
        (sanitizeReferenceValue(revisionRef?.slug) as string | undefined) ??
        (sanitizeReferenceValue(refs.evaluator_slug) as string | undefined)

    return {artifactId, revisionId, slug}
}

/** Deduplicate refs by artifact ID (preferred) or slug */
export const deduplicateRefs = (refs: EvaluatorRef[]): EvaluatorRef[] => {
    const seen = new Map<string, EvaluatorRef>()
    for (const ref of refs) {
        const key = ref.artifactId ?? ref.revisionId ?? ref.slug
        if (!key) continue
        if (!seen.has(key)) {
            seen.set(key, ref)
        } else {
            // Merge: prefer the version with more information
            const existing = seen.get(key)!
            seen.set(key, {
                artifactId: existing.artifactId ?? ref.artifactId,
                revisionId: existing.revisionId ?? ref.revisionId,
                slug: existing.slug ?? ref.slug,
            })
        }
    }
    return Array.from(seen.values())
}

// ============================================================================
// METRIC EXTRACTION
// ============================================================================

export const extractMetrics = (evaluator: {
    slug?: string | null
    id: string
    data?: Record<string, unknown> | null
}): MetricColumnDefinition[] => {
    const properties = resolveOutputSchemaProperties(evaluator?.data) ?? {}
    return Object.entries(properties).map(([key, _schema]) => {
        const schema = _schema as Record<string, unknown>
        return {
            name: key,
            kind: "metric" as const,
            path: key,
            stepKey: evaluator.slug || evaluator.id || "metric",
            metricType: typeof schema?.type === "string" ? schema.type : METRIC_TYPE_FALLBACK,
            displayLabel: typeof schema?.title === "string" ? schema.title : titleize(key),
            description: typeof schema?.description === "string" ? schema.description : undefined,
        }
    })
}

// ============================================================================
// DEFINITION BUILDERS
// ============================================================================

export const toEvaluatorDefinitionFromWorkflow = (workflow: {
    id: string
    name?: string | null
    slug?: string | null
    description?: string | null
    version?: number | null
    data?: Record<string, unknown> | null
    meta?: Record<string, unknown> | null
}): EvaluatorDefinition => {
    const dataVersion = workflow.data?.version as number | undefined
    const metaVersion = workflow.meta?.version as number | undefined

    return {
        id: workflow.id,
        name: workflow.name || workflow.slug || workflow.id,
        slug: workflow.slug ?? undefined,
        description: workflow.description,
        version: workflow.version ?? dataVersion ?? metaVersion ?? null,
        metrics: extractMetrics({
            id: workflow.id,
            slug: workflow.slug,
            data: workflow.data,
        }),
        raw: workflow,
    }
}

export const toEvaluatorDefinitionFromRaw = (raw: Record<string, unknown>): EvaluatorDefinition => {
    const id = raw.id as string
    const name = (raw.name as string) || (raw.slug as string) || id
    const slug = raw.slug as string | undefined
    const description = raw.description as string | null | undefined
    const data = raw.data as Record<string, unknown> | undefined
    const meta = raw.meta as Record<string, unknown> | undefined

    return {
        id,
        name,
        slug,
        description,
        version:
            (raw.version as number | null) ??
            (data?.version as number | null) ??
            (meta?.version as number | null) ??
            null,
        metrics: extractMetrics({id, slug, data}),
        raw,
    }
}
