/**
 * Unit tests for the reactive trace-ref resolver atom.
 *
 * Covers:
 *   • buildResolvedTraceRefsKey            — encoding stability + dedup
 *   • buildResolvedTraceRefsKeyFromSpan    — empty-key sentinel
 *   • resolvedTraceRefsAtomFamily          — disabled-state shape, success path
 *
 * The async resolver itself (network shaping, mismatch guard, TTL eviction)
 * is covered exhaustively in traceRefResolution.test.ts; here we only assert
 * that the atom layer wires the key, the project, and the query state through
 * correctly.
 */

import {beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", () => ({
    retrieveWorkflowRevision: vi.fn(),
}))

import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"

import {retrieveWorkflowRevision} from "@agenta/entities/workflow"

import {
    EMPTY_TRACE_REFS_KEY,
    buildResolvedTraceRefsKey,
    buildResolvedTraceRefsKeyFromSpan,
    resolvedTraceRefsAtomFamily,
} from "../../src/state/controllers/resolvedTraceRefsAtom"
import {
    __resetTraceRefResolutionCache,
    type SpanWithReferences,
} from "../../src/state/controllers/traceRefResolution"

const mockedRetrieve = vi.mocked(retrieveWorkflowRevision)

beforeEach(() => {
    __resetTraceRefResolutionCache()
    mockedRetrieve.mockReset()
})

// ── buildResolvedTraceRefsKey ────────────────────────────────────────────

describe("buildResolvedTraceRefsKey", () => {
    it("returns the empty sentinel when no refs are set", () => {
        expect(buildResolvedTraceRefsKey({})).toBe(EMPTY_TRACE_REFS_KEY)
    })

    it("produces the same key for the same refs (cache stability)", () => {
        const refs = {
            application: {slug: "my-app"},
            application_variant: {slug: "my-app.default"},
        }
        expect(buildResolvedTraceRefsKey(refs)).toBe(buildResolvedTraceRefsKey(refs))
    })

    it("distinguishes by id vs slug", () => {
        const a = buildResolvedTraceRefsKey({application: {id: "abc"}})
        const b = buildResolvedTraceRefsKey({application: {slug: "abc"}})
        expect(a).not.toBe(b)
    })

    it("treats empty-string fields as absent", () => {
        // Empty strings on the wire must not promote a ref to "identifying".
        // Otherwise the resolver fires a request with no scope and 400s.
        const key = buildResolvedTraceRefsKey({
            application: {id: "", slug: "my-app", version: ""},
        })
        const expected = buildResolvedTraceRefsKey({
            application: {slug: "my-app"},
        })
        expect(key).toBe(expected)
    })
})

// ── buildResolvedTraceRefsKeyFromSpan ────────────────────────────────────

describe("buildResolvedTraceRefsKeyFromSpan", () => {
    it("returns the empty sentinel for null/undefined spans", () => {
        expect(buildResolvedTraceRefsKeyFromSpan(null)).toBe(EMPTY_TRACE_REFS_KEY)
        expect(buildResolvedTraceRefsKeyFromSpan(undefined)).toBe(EMPTY_TRACE_REFS_KEY)
    })

    it("returns the empty sentinel for spans with no identifying app ref", () => {
        const span: SpanWithReferences = {attributes: {ag: {references: {}}}}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        expect(buildResolvedTraceRefsKeyFromSpan(span as any)).toBe(EMPTY_TRACE_REFS_KEY)
    })

    it("encodes refs from the ag.references dict", () => {
        const span: SpanWithReferences = {
            attributes: {ag: {references: {application: {slug: "demo"}}}},
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const key = buildResolvedTraceRefsKeyFromSpan(span as any)
        expect(key).not.toBe(EMPTY_TRACE_REFS_KEY)
        expect(key).toBe(buildResolvedTraceRefsKey({application: {slug: "demo"}}))
    })

    it("encodes refs from the top-level references array", () => {
        const span: SpanWithReferences = {
            references: [{slug: "demo", attributes: {key: "application"}}],
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const key = buildResolvedTraceRefsKeyFromSpan(span as any)
        expect(key).toBe(buildResolvedTraceRefsKey({application: {slug: "demo"}}))
    })
})

// ── resolvedTraceRefsAtomFamily ──────────────────────────────────────────

describe("resolvedTraceRefsAtomFamily", () => {
    it("stays disabled (no fetch) when keyed with the empty sentinel", async () => {
        const store = createStore()
        store.set(projectIdAtom, "proj-1")

        const atom = resolvedTraceRefsAtomFamily(EMPTY_TRACE_REFS_KEY)
        // Subscribe so the query actually evaluates.
        const unsubscribe = store.sub(atom, () => {})
        // Yield once so any pending microtasks resolve.
        await Promise.resolve()
        expect(mockedRetrieve).not.toHaveBeenCalled()
        unsubscribe()
    })

    it("stays disabled (no fetch) when projectId is null", async () => {
        const store = createStore()
        store.set(projectIdAtom, null)

        const key = buildResolvedTraceRefsKey({application: {slug: "demo"}})
        const atom = resolvedTraceRefsAtomFamily(key)
        const unsubscribe = store.sub(atom, () => {})
        await Promise.resolve()
        expect(mockedRetrieve).not.toHaveBeenCalled()
        unsubscribe()
    })

    it("calls the resolver with the decoded refs and the project", async () => {
        mockedRetrieve.mockResolvedValueOnce({
            id: "rev-1",
            workflow_id: "app-1",
            artifact_slug: "demo",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)

        const store = createStore()
        store.set(projectIdAtom, "proj-1")

        const key = buildResolvedTraceRefsKey({application: {slug: "demo"}})
        const atom = resolvedTraceRefsAtomFamily(key)
        const unsubscribe = store.sub(atom, () => {})

        // Wait for the async query to settle. atomWithQuery schedules the
        // fetch on subscription; a microtask flush is enough since the
        // mocked resolver resolves synchronously.
        await new Promise((r) => setTimeout(r, 0))

        expect(mockedRetrieve).toHaveBeenCalledTimes(1)
        const callArg = mockedRetrieve.mock.calls[0]?.[0]
        expect(callArg).toMatchObject({
            projectId: "proj-1",
            workflowRef: {slug: "demo"},
        })

        unsubscribe()
    })
})
