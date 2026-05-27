/**
 * Reactive resolver for trace → revision IDs.
 *
 * Wraps `resolveTraceRefs` (the imperative resolver used by the Playground
 * button) in a TanStack-Query atom so the trace drawer's side panel can
 * subscribe to resolved `{appId, revisionId}` for slug-only traces.
 *
 * Why this exists: the side panel renders application / variant / environment
 * tags with links built from the trace's references. When the trace was
 * emitted with slug-only refs (the common case for third-party
 * instrumentations), the raw refs carry no `id`, and the link templates
 * collapse to empty hrefs. The resolver already maps slugs back to UUIDs
 * via `POST /workflows/revisions/retrieve`; this module makes that mapping
 * reactive so every consumer in the trace drawer can use it, not just the
 * Playground click handler.
 */

import type {TraceSpanNode} from "@agenta/entities/trace"
import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {
    extractReferences,
    hasAppReference,
    resolveTraceRefs,
    TRACE_REF_RESOLUTION_TTL_MS,
    type ResolvedTraceRefs,
    type SpanWithReferences,
    type TraceReference,
    type TraceReferences,
} from "./traceRefResolution"

const isNonEmptyString = (value: unknown): value is string =>
    typeof value === "string" && value.length > 0

/**
 * Encode one ref triple (id / slug / version) into a positional string.
 * Empty parts are kept so the decoder can recover the same shape.
 */
const encodeRef = (ref?: TraceReference): string => {
    if (!ref) return ""
    const id = isNonEmptyString(ref.id) ? ref.id : ""
    const slug = isNonEmptyString(ref.slug) ? ref.slug : ""
    const version = isNonEmptyString(ref.version) ? ref.version : ""
    if (!id && !slug && !version) return ""
    return `${id}/${slug}/${version}`
}

const decodeRef = (part: string): TraceReference | undefined => {
    if (!part) return undefined
    const [id, slug, version] = part.split("/")
    const ref: TraceReference = {}
    if (id) ref.id = id
    if (slug) ref.slug = slug
    if (version) ref.version = version
    return Object.keys(ref).length ? ref : undefined
}

const KEY_SEPARATOR = "|"
// Number of ref slots encoded in the key (application × 3, environment × 3).
// An empty key is six separators between seven empty slots — keep this in
// sync with `buildResolvedTraceRefsKey`'s slot list.
const KEY_SLOT_COUNT = 6

/** Sentinel for "no identifying refs"; family entry kept disabled. */
export const EMPTY_TRACE_REFS_KEY = KEY_SEPARATOR.repeat(KEY_SLOT_COUNT - 1)

/**
 * Stable cache key built from the identifying app + environment refs.
 * Two spans that carry the same combination share the same atom (and the
 * same underlying query cache entry).
 *
 * Environment refs are included because the backend retrieve endpoint can
 * resolve through a deployment slot to find the revision currently
 * deployed there (issue #4426 problem 2d).
 */
export const buildResolvedTraceRefsKey = (refs: TraceReferences): string =>
    [
        encodeRef(refs.application),
        encodeRef(refs.application_variant),
        encodeRef(refs.application_revision),
        encodeRef(refs.environment),
        encodeRef(refs.environment_variant),
        encodeRef(refs.environment_revision),
    ].join(KEY_SEPARATOR)

const parseResolvedTraceRefsKey = (refsKey: string): TraceReferences => {
    const parts = refsKey.split(KEY_SEPARATOR)
    return {
        application: decodeRef(parts[0] ?? ""),
        application_variant: decodeRef(parts[1] ?? ""),
        application_revision: decodeRef(parts[2] ?? ""),
        environment: decodeRef(parts[3] ?? ""),
        environment_variant: decodeRef(parts[4] ?? ""),
        environment_revision: decodeRef(parts[5] ?? ""),
    }
}

/**
 * Build the resolver atom key for a span without exposing the encoding.
 * Returns `EMPTY_TRACE_REFS_KEY` when the span has no identifying app ref
 * — the family entry stays disabled, so no request is fired.
 */
export const buildResolvedTraceRefsKeyFromSpan = (
    span: TraceSpanNode | null | undefined,
): string => {
    if (!span) return EMPTY_TRACE_REFS_KEY
    if (!hasAppReference(span as SpanWithReferences)) return EMPTY_TRACE_REFS_KEY
    return buildResolvedTraceRefsKey(extractReferences(span))
}

/**
 * Atom family of resolved trace refs. Returns the standard TanStack Query
 * result shape: `data` is `{appId, revisionId}` (both nullable when the
 * backend has no match), plus `isPending`, `isError`, etc.
 *
 * The atom is `enabled: false` when no project is set or when the key
 * carries no identifying refs, so consumers can always call it without
 * conditional hooks.
 */
export const resolvedTraceRefsAtomFamily = atomFamily((refsKey: string) =>
    atomWithQuery<ResolvedTraceRefs>((get) => {
        const projectId = get(projectIdAtom)
        const refs = parseResolvedTraceRefsKey(refsKey)
        const enabled = !!projectId && refsKey !== EMPTY_TRACE_REFS_KEY

        return {
            queryKey: ["resolvedTraceRefs", projectId, refsKey],
            queryFn: () => resolveTraceRefs(refs, projectId),
            enabled,
            staleTime: TRACE_REF_RESOLUTION_TTL_MS,
            retry: false,
        }
    }),
)
