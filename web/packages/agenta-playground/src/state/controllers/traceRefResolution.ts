/**
 * Trace ref → revision id resolver.
 *
 * Third-party instrumentations (n8n, LangChain-style adapters) often emit
 * trace references as slugs or versions instead of UUIDs. The resolver maps
 * any combination of identifying refs (app / variant / revision × id / slug,
 * or version when a higher-level identifier is also present) into a concrete
 * `{appId, revisionId}` via the backend's `POST /workflows/revisions/retrieve`
 * endpoint.
 *
 * Two predicates live here so the UI gate (`hasAppReference`) and the
 * resolver gate (inside `resolveTraceRefs`) cannot drift apart — when they
 * disagree, the Playground button enables but the resolver silently bails
 * to ephemeral.
 */
import type {TraceSpanNode} from "@agenta/entities/trace"
import {retrieveWorkflowRevision} from "@agenta/entities/workflow"

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Reference structure from backend (SimpleTraceReferences):
 * - application: {id, slug, version}
 * - application_variant: {id, slug, version}
 * - application_revision: {id, slug, version}
 * - evaluator: {id, slug, version}
 * - evaluator_variant: {id, slug, version}
 * - evaluator_revision: {id, slug, version}
 */
export interface TraceReference {
    id?: string
    slug?: string
    version?: string
}

export interface TraceReferences {
    application?: TraceReference
    application_variant?: TraceReference
    application_revision?: TraceReference
    evaluator?: TraceReference
    evaluator_variant?: TraceReference
    evaluator_revision?: TraceReference
}

export interface ResolvedTraceRefs {
    appId: string | null
    revisionId: string | null
}

/**
 * Smallest identifying ref for the backend. The resolver picks `id` over
 * `slug` over `version` and sends only the chosen field — never a mix.
 */
export type RefShape = {id: string} | {slug: string} | {version: string} | undefined

// ── Helpers ──────────────────────────────────────────────────────────────

/** Non-empty string check; mirrors `asString` in playgroundController. */
const isNonEmptyString = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0

/**
 * Build the smallest identifying ref for the resolver. Prefers `id` over
 * `slug` over `version`. Returns `undefined` when nothing is set, so the
 * caller can omit the field from the request entirely.
 */
export function buildRefForResolver(ref: TraceReference | undefined): RefShape {
    if (!ref) return undefined
    if (isNonEmptyString(ref.id)) return {id: ref.id}
    if (isNonEmptyString(ref.slug)) return {slug: ref.slug}
    if (isNonEmptyString(ref.version)) return {version: ref.version}
    return undefined
}

const IDENTIFYING_REF_KEYS = ["application", "application_variant", "application_revision"] as const

/**
 * Structural shape of a span as far as `hasAppReference` is concerned. Both
 * `@agenta/entities/trace`'s `TraceSpanNode` and OSS's `TraceSpanNode`
 * satisfy this. Kept loose so the predicate is callable from either side
 * without a cast.
 */
export interface SpanWithReferences {
    attributes?: unknown
    references?: unknown
}

/**
 * Check if a span carries any reference the resolver can use to identify a
 * workflow revision. Accepts application, application_variant, or
 * application_revision refs — each by `id` or `slug`. A bare `version`
 * does not satisfy this predicate because the resolver cannot scope it
 * (the backend rejects version-only requests with 400), so enabling the
 * button on those traces would just spin and fall through to ephemeral.
 */
export function hasAppReference(span: SpanWithReferences): boolean {
    const hasIdOrSlug = (ref: unknown): boolean => {
        if (!ref || typeof ref !== "object") return false
        const r = ref as {id?: unknown; slug?: unknown}
        return isNonEmptyString(r.id) || isNonEmptyString(r.slug)
    }

    const attrs = span.attributes as Record<string, unknown> | undefined
    const ag = attrs?.ag as Record<string, unknown> | undefined
    const agRefs = ag?.references as Record<string, unknown> | undefined
    if (agRefs && IDENTIFYING_REF_KEYS.some((k) => hasIdOrSlug(agRefs[k]))) return true

    const topRefs = span.references as
        | {id?: string; slug?: string; attributes?: {key?: string}}[]
        | undefined
    if (Array.isArray(topRefs)) {
        return topRefs.some(
            (ref) =>
                ref.attributes?.key !== undefined &&
                (IDENTIFYING_REF_KEYS as readonly string[]).includes(ref.attributes.key) &&
                (isNonEmptyString(ref.id) || isNonEmptyString(ref.slug)),
        )
    }
    return false
}

/**
 * Extract references from `ag.references` (dict format) or the top-level
 * references array. Returns whichever fields the span carried — populated
 * fields point at the original ref objects (callers MUST treat them as
 * read-only or copy before mutating).
 */
export function extractReferences(span: TraceSpanNode): TraceReferences {
    const result: TraceReferences = {}

    const agData = (span.attributes as Record<string, unknown>)?.ag as Record<string, unknown>
    const agRefs = agData?.references as Record<string, TraceReference> | undefined
    if (agRefs) {
        if (agRefs.application) result.application = agRefs.application
        if (agRefs.application_variant) result.application_variant = agRefs.application_variant
        if (agRefs.application_revision) result.application_revision = agRefs.application_revision
        if (agRefs.evaluator) result.evaluator = agRefs.evaluator
        if (agRefs.evaluator_variant) result.evaluator_variant = agRefs.evaluator_variant
        if (agRefs.evaluator_revision) result.evaluator_revision = agRefs.evaluator_revision
    }

    const topRefs = span.references as
        | {id?: string; slug?: string; version?: string; attributes?: {key?: string}}[]
        | undefined
    if (topRefs && Array.isArray(topRefs)) {
        for (const ref of topRefs) {
            const key = ref.attributes?.key
            if (!key) continue
            const refData: TraceReference = {id: ref.id, slug: ref.slug, version: ref.version}
            if (key === "application" && !result.application) result.application = refData
            if (key === "application_variant" && !result.application_variant)
                result.application_variant = refData
            if (key === "application_revision" && !result.application_revision)
                result.application_revision = refData
            if (key === "evaluator" && !result.evaluator) result.evaluator = refData
            if (key === "evaluator_variant" && !result.evaluator_variant)
                result.evaluator_variant = refData
            if (key === "evaluator_revision" && !result.evaluator_revision)
                result.evaluator_revision = refData
        }
    }

    return result
}

// ── Resolver ─────────────────────────────────────────────────────────────

/**
 * Session cache for trace ref → revision lookups. TTL bounds staleness if a
 * slug starts pointing at a different revision mid-session (rare, but
 * possible if someone archives + recreates a workflow with the same slug).
 * Keyed by the JSON of the assembled request. Successful results only —
 * nulls are not cached so transient failures don't block retries.
 */
export const TRACE_REF_RESOLUTION_TTL_MS = 5 * 60 * 1000
const traceRefResolutionCache = new Map<string, {at: number; value: ResolvedTraceRefs}>()

/** Test-only: drop all cached entries. Not exported from package barrel. */
export function __resetTraceRefResolutionCache(): void {
    traceRefResolutionCache.clear()
}

/**
 * Resolve any combination of trace refs (app / variant / revision, each by
 * id, slug, or version) into a concrete `{appId, revisionId}` via
 * `POST /workflows/revisions/retrieve`.
 *
 * Sends every identifier the trace carries — the backend picks the most
 * specific revision consistent with all of them, falling back to the
 * default variant's latest when fields are missing.
 *
 * Returns `{appId: null, revisionId: null}` when the project is unknown,
 * when nothing identifying is present, or when the backend has no match.
 * Callers should fall back to ephemeral on a null result.
 *
 * Defensive verification: when we asked by `application.slug`, the response
 * `artifact_slug` must match — guards against stale data and any backend
 * regression that returns the wrong workflow.
 */
export async function resolveTraceRefs(
    refs: TraceReferences,
    projectId: string | null | undefined,
): Promise<ResolvedTraceRefs> {
    if (!projectId) return {appId: null, revisionId: null}

    const workflowRef = buildRefForResolver(refs.application)
    const variantRef = buildRefForResolver(refs.application_variant)
    const revisionRef = buildRefForResolver(refs.application_revision)

    // The backend needs at least one identifying ref (id or slug at any
    // level). A bare `version` on the revision ref alone is rejected — it's
    // a per-variant sequence number with no scope — and a request with no
    // refs at all is meaningless. Skip the call in both cases.
    const hasWorkflowIdent = !!workflowRef && ("id" in workflowRef || "slug" in workflowRef)
    const hasVariantIdent = !!variantRef && ("id" in variantRef || "slug" in variantRef)
    const hasRevisionIdent = !!revisionRef && ("id" in revisionRef || "slug" in revisionRef)
    const hasNoIdentifyingRef = !hasWorkflowIdent && !hasVariantIdent && !hasRevisionIdent
    if (hasNoIdentifyingRef) return {appId: null, revisionId: null}

    const cacheKey = JSON.stringify({projectId, workflowRef, variantRef, revisionRef})
    const cached = traceRefResolutionCache.get(cacheKey)
    if (cached && Date.now() - cached.at < TRACE_REF_RESOLUTION_TTL_MS) {
        return cached.value
    }

    const askedAppSlug = workflowRef && "slug" in workflowRef ? workflowRef.slug : undefined

    try {
        const revision = await retrieveWorkflowRevision({
            projectId,
            ...(workflowRef ? {workflowRef} : {}),
            ...(variantRef ? {workflowVariantRef: variantRef} : {}),
            ...(revisionRef ? {workflowRevisionRef: revisionRef} : {}),
        })

        if (!revision) return {appId: null, revisionId: null}

        // When we asked by app slug, verify the response actually belongs
        // to that workflow. We trust id-based requests without further
        // checking (the backend cannot match the wrong id to a slug).
        if (askedAppSlug && revision.artifact_slug && revision.artifact_slug !== askedAppSlug) {
            console.warn(
                `[openFromTrace] Resolver returned mismatched workflow ` +
                    `(asked for "${askedAppSlug}", got "${revision.artifact_slug}") — ` +
                    `falling back to ephemeral.`,
            )
            return {appId: null, revisionId: null}
        }

        const result: ResolvedTraceRefs = {
            appId: isNonEmptyString(revision.workflow_id) ? revision.workflow_id : null,
            revisionId: isNonEmptyString(revision.id) ? revision.id : null,
        }
        traceRefResolutionCache.set(cacheKey, {at: Date.now(), value: result})
        return result
    } catch (error) {
        console.warn("[openFromTrace] Resolver call failed, falling back to ephemeral.", error)
        return {appId: null, revisionId: null}
    }
}
