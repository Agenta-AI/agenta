/**
 * Unit tests for the trace ref → revision resolver.
 *
 * Covers:
 *   • buildRefForResolver — id > slug > version priority, empty-string handling
 *   • hasAppReference     — UI gate predicate (ag.references + top-level array)
 *   • resolveTraceRefs    — request shaping, gating, mismatch guard, cache TTL
 *
 * The retrieveWorkflowRevision import from `@agenta/entities/workflow` is
 * mocked here so tests don't hit axios or the network. The molecule and other
 * heavy entity machinery is unused on this path, so the bare mock is enough.
 */

import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Mock the entities workflow API surface used by resolveTraceRefs. Other
// exports the package surfaces (workflowMolecule, createEphemeralWorkflow,
// etc.) are not referenced by this test file, so we declare only the symbol
// we need.
vi.mock("@agenta/entities/workflow", () => ({
    retrieveWorkflowRevision: vi.fn(),
}))

import {retrieveWorkflowRevision} from "@agenta/entities/workflow"

import {
    __resetTraceRefResolutionCache,
    buildRefForResolver,
    hasAppReference,
    resolveTraceRefs,
    TRACE_REF_RESOLUTION_TTL_MS,
    type SpanWithReferences,
    type TraceReference,
} from "../../src/state/controllers/traceRefResolution"

const mockedRetrieve = vi.mocked(retrieveWorkflowRevision)

beforeEach(() => {
    __resetTraceRefResolutionCache()
    mockedRetrieve.mockReset()
})

afterEach(() => {
    vi.useRealTimers()
})

// ── buildRefForResolver ──────────────────────────────────────────────────

describe("buildRefForResolver", () => {
    it("returns undefined for undefined input", () => {
        expect(buildRefForResolver(undefined)).toBeUndefined()
    })

    it("returns undefined when all fields are missing", () => {
        expect(buildRefForResolver({})).toBeUndefined()
    })

    it("returns undefined when all fields are empty strings", () => {
        // Empty strings are NOT identifiers — they exist in the wire shape
        // but carry no information. Treating them as identifiers would let
        // a useless request through and trigger a 400 from the backend.
        expect(buildRefForResolver({id: "", slug: "", version: ""})).toBeUndefined()
    })

    it("prefers id over slug and version when all three are set", () => {
        const ref: TraceReference = {id: "abc", slug: "my-app", version: "v1"}
        expect(buildRefForResolver(ref)).toEqual({id: "abc"})
    })

    it("falls back to slug when id is missing", () => {
        expect(buildRefForResolver({slug: "my-app", version: "v1"})).toEqual({slug: "my-app"})
    })

    it("falls back to slug when id is empty", () => {
        expect(buildRefForResolver({id: "", slug: "my-app"})).toEqual({slug: "my-app"})
    })

    it("falls back to version when only version is set", () => {
        expect(buildRefForResolver({version: "v1"})).toEqual({version: "v1"})
    })

    it("never returns an object that mixes id and slug", () => {
        // The backend matches on the most specific field present; sending
        // both would be redundant and could surface inconsistencies.
        const result = buildRefForResolver({id: "abc", slug: "my-app"})
        expect(result).toEqual({id: "abc"})
        expect(result).not.toHaveProperty("slug")
    })
})

// ── hasAppReference ──────────────────────────────────────────────────────

describe("hasAppReference", () => {
    const makeSpan = (data: Partial<SpanWithReferences>): SpanWithReferences => data

    it("returns false for empty span", () => {
        expect(hasAppReference(makeSpan({}))).toBe(false)
    })

    it("accepts ag.references with application.id", () => {
        const span = makeSpan({
            attributes: {ag: {references: {application: {id: "abc"}}}},
        })
        expect(hasAppReference(span)).toBe(true)
    })

    it("accepts ag.references with application.slug", () => {
        const span = makeSpan({
            attributes: {ag: {references: {application: {slug: "my-app"}}}},
        })
        expect(hasAppReference(span)).toBe(true)
    })

    it("accepts ag.references with application_variant", () => {
        const span = makeSpan({
            attributes: {ag: {references: {application_variant: {slug: "v1"}}}},
        })
        expect(hasAppReference(span)).toBe(true)
    })

    it("accepts ag.references with application_revision", () => {
        const span = makeSpan({
            attributes: {ag: {references: {application_revision: {id: "rev-1"}}}},
        })
        expect(hasAppReference(span)).toBe(true)
    })

    it("rejects ag.references with only a bare version", () => {
        // version alone has no scope — the resolver bails out, so the UI
        // shouldn't enable the button on it.
        const span = makeSpan({
            attributes: {ag: {references: {application_revision: {version: "1"}}}},
        })
        expect(hasAppReference(span)).toBe(false)
    })

    it("rejects ag.references with empty-string id and slug", () => {
        // Predicate parity with the resolver's `asString` rule — without
        // the empty-string check, the UI gate would disagree with the
        // resolver gate (button enables, click spins, falls to ephemeral).
        const span = makeSpan({
            attributes: {ag: {references: {application: {id: "", slug: ""}}}},
        })
        expect(hasAppReference(span)).toBe(false)
    })

    it("ignores evaluator-only refs (not in scope for the playground gate)", () => {
        const span = makeSpan({
            attributes: {ag: {references: {evaluator: {id: "ev-1"}}}},
        })
        expect(hasAppReference(span)).toBe(false)
    })

    it("accepts a top-level references array with application key + id", () => {
        const span = makeSpan({
            references: [{attributes: {key: "application"}, id: "abc"}],
        })
        expect(hasAppReference(span)).toBe(true)
    })

    it("accepts a top-level references array with variant key + slug", () => {
        const span = makeSpan({
            references: [{attributes: {key: "application_variant"}, slug: "v1"}],
        })
        expect(hasAppReference(span)).toBe(true)
    })

    it("rejects top-level entries with the right key but empty id/slug", () => {
        const span = makeSpan({
            references: [{attributes: {key: "application"}, id: "", slug: ""}],
        })
        expect(hasAppReference(span)).toBe(false)
    })

    it("rejects top-level entries with unrecognized keys", () => {
        const span = makeSpan({
            references: [{attributes: {key: "evaluator"}, id: "ev-1"}],
        })
        expect(hasAppReference(span)).toBe(false)
    })
})

// ── resolveTraceRefs ─────────────────────────────────────────────────────

describe("resolveTraceRefs", () => {
    const fakeRevision = {
        id: "rev-uuid",
        workflow_id: "workflow-uuid",
        artifact_slug: "my-app",
    }

    it("returns null result when projectId is missing", async () => {
        const out = await resolveTraceRefs({application: {id: "abc"}}, undefined)
        expect(out).toEqual({appId: null, revisionId: null})
        expect(mockedRetrieve).not.toHaveBeenCalled()
    })

    it("returns null result when projectId is empty string", async () => {
        const out = await resolveTraceRefs({application: {id: "abc"}}, "")
        expect(out).toEqual({appId: null, revisionId: null})
        expect(mockedRetrieve).not.toHaveBeenCalled()
    })

    it("returns null result when refs are empty", async () => {
        const out = await resolveTraceRefs({}, "proj-1")
        expect(out).toEqual({appId: null, revisionId: null})
        expect(mockedRetrieve).not.toHaveBeenCalled()
    })

    it("returns null result when only revision.version is present", async () => {
        // bare-version is rejected by the backend with 400, so the resolver
        // skips the request entirely.
        const out = await resolveTraceRefs({application_revision: {version: "1"}}, "proj-1")
        expect(out).toEqual({appId: null, revisionId: null})
        expect(mockedRetrieve).not.toHaveBeenCalled()
    })

    it("calls retrieve with workflow_ref by id when only app.id is present", async () => {
        mockedRetrieve.mockResolvedValueOnce(fakeRevision as never)
        const out = await resolveTraceRefs({application: {id: "abc"}}, "proj-1")
        expect(mockedRetrieve).toHaveBeenCalledWith({
            projectId: "proj-1",
            workflowRef: {id: "abc"},
        })
        expect(out).toEqual({appId: "workflow-uuid", revisionId: "rev-uuid"})
    })

    it("sends every ref the trace carries (variant.slug + revision.id)", async () => {
        mockedRetrieve.mockResolvedValueOnce(fakeRevision as never)
        await resolveTraceRefs(
            {
                application: {slug: "my-app"},
                application_variant: {slug: "v1"},
                application_revision: {id: "rev-uuid"},
            },
            "proj-1",
        )
        expect(mockedRetrieve).toHaveBeenCalledWith({
            projectId: "proj-1",
            workflowRef: {slug: "my-app"},
            workflowVariantRef: {slug: "v1"},
            workflowRevisionRef: {id: "rev-uuid"},
        })
    })

    it("returns null when the backend has no match", async () => {
        mockedRetrieve.mockResolvedValueOnce(null as never)
        const out = await resolveTraceRefs({application: {slug: "ghost"}}, "proj-1")
        expect(out).toEqual({appId: null, revisionId: null})
    })

    it("returns null and warns when the response slug doesn't match the asked slug", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        mockedRetrieve.mockResolvedValueOnce({
            ...fakeRevision,
            artifact_slug: "different-app",
        } as never)
        const out = await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")
        expect(out).toEqual({appId: null, revisionId: null})
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining('asked for "my-app", got "different-app"'),
        )
        warn.mockRestore()
    })

    it("trusts id-based requests without slug verification", async () => {
        // We didn't ask by slug, so artifact_slug mismatch doesn't matter.
        mockedRetrieve.mockResolvedValueOnce({
            ...fakeRevision,
            artifact_slug: "anything",
        } as never)
        const out = await resolveTraceRefs({application: {id: "abc"}}, "proj-1")
        expect(out).toEqual({appId: "workflow-uuid", revisionId: "rev-uuid"})
    })

    it("returns null and warns when retrieveWorkflowRevision throws", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        mockedRetrieve.mockRejectedValueOnce(new Error("boom"))
        const out = await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")
        expect(out).toEqual({appId: null, revisionId: null})
        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("Resolver call failed"),
            expect.any(Error),
        )
        warn.mockRestore()
    })

    it("caches successful results within TTL (no second network call)", async () => {
        mockedRetrieve.mockResolvedValueOnce(fakeRevision as never)
        const first = await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")
        const second = await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")
        expect(first).toEqual(second)
        expect(mockedRetrieve).toHaveBeenCalledTimes(1)
    })

    it("expires cache entries after TTL elapses", async () => {
        vi.useFakeTimers()
        const start = Date.parse("2026-01-01T00:00:00Z")
        vi.setSystemTime(start)

        mockedRetrieve.mockResolvedValueOnce(fakeRevision as never)
        await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")

        // Just past TTL — should refetch.
        vi.setSystemTime(start + TRACE_REF_RESOLUTION_TTL_MS + 1)
        mockedRetrieve.mockResolvedValueOnce(fakeRevision as never)
        await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")

        expect(mockedRetrieve).toHaveBeenCalledTimes(2)
    })

    it("does NOT cache failures (next call retries)", async () => {
        mockedRetrieve.mockResolvedValueOnce(null as never)
        const first = await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")
        expect(first).toEqual({appId: null, revisionId: null})

        // Backend now succeeds — we should hit it again, not return the
        // stale null.
        mockedRetrieve.mockResolvedValueOnce(fakeRevision as never)
        const second = await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")
        expect(second).toEqual({appId: "workflow-uuid", revisionId: "rev-uuid"})
        expect(mockedRetrieve).toHaveBeenCalledTimes(2)
    })

    it("does NOT cache exceptions either", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        mockedRetrieve.mockRejectedValueOnce(new Error("transient"))
        await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")

        mockedRetrieve.mockResolvedValueOnce(fakeRevision as never)
        const second = await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")
        expect(second).toEqual({appId: "workflow-uuid", revisionId: "rev-uuid"})
        expect(mockedRetrieve).toHaveBeenCalledTimes(2)
        warn.mockRestore()
    })

    it("returns null result fields when the response omits ids", async () => {
        mockedRetrieve.mockResolvedValueOnce({
            id: "",
            workflow_id: null,
            artifact_slug: "my-app",
        } as never)
        const out = await resolveTraceRefs({application: {slug: "my-app"}}, "proj-1")
        expect(out).toEqual({appId: null, revisionId: null})
    })
})
