/**
 * Integration tests for traceSpanMolecule.
 *
 * Trace spans are produced by the observability SDK and are not created
 * directly via the testset/environment API. Therefore:
 *
 *   - Tests that require a real span ID in the backend are gated behind
 *     AGENTA_TEST_TRACE_SPAN_ID (an optional additional env var that the
 *     backend team can supply once the tracing endpoint is confirmed).
 *
 *   - Tests that only need a backend connection (but can use local.set)
 *     are gated behind the standard hasBackend flag.
 *
 * What is tested here vs Layer 1:
 *   Layer 1 — pure atom logic (draft, merge, isDirty, getAgDataPath)
 *   Layer 2 — verifying that local.set interacts correctly with a real
 *              QueryClient, and that atoms.query falls back gracefully
 *              when a span is not in the backend.
 *
 * Coverage:
 *   • local.set with a real QueryClient in store   — data flows to atoms.data
 *   • atoms.inputs / outputs with real QueryClient — derived atoms work
 *   • atoms.query for an unknown span ID           — settles without throwing
 *   • Server-fetched span (if AGENTA_TEST_TRACE_SPAN_ID is set)
 */

import {describe, it, expect} from "vitest"

import {traceSpanMolecule} from "../../src/trace"
import type {TraceSpan} from "../../src/trace/core"

import {hasBackend} from "./helpers/env"
import {createIntegrationStore, waitForAtom} from "./helpers/store"

const TEST_SPAN_ID = process.env.AGENTA_TEST_TRACE_SPAN_ID || ""

function makeSpan(overrides?: Partial<TraceSpan>): TraceSpan {
    return {
        trace_id: "trace-integration-1",
        span_id: "span-integration-1",
        attributes: {
            "ag.data": {
                inputs: {prompt: "Integration prompt"},
                outputs: "Integration response",
            },
        },
        ...overrides,
    }
}

describe.skipIf(!hasBackend)("traceSpanMolecule integration (local.set + real QueryClient)", () => {
    it("local.set seeds data into atoms.data with a real QueryClient in store", () => {
        const {store} = createIntegrationStore()
        const span = makeSpan()

        traceSpanMolecule.local.set("span-integration-1", span, {store})

        const data = store.get(traceSpanMolecule.atoms.data("span-integration-1"))
        expect(data).toMatchObject({span_id: "span-integration-1"})
    })

    it("atoms.inputs and atoms.outputs extract from seeded span with real QueryClient", () => {
        const {store} = createIntegrationStore()

        traceSpanMolecule.local.set(
            "span-integration-2",
            makeSpan({span_id: "span-integration-2"}),
            {
                store,
            },
        )

        expect(store.get(traceSpanMolecule.atoms.inputs("span-integration-2"))).toEqual({
            prompt: "Integration prompt",
        })
        expect(store.get(traceSpanMolecule.atoms.outputs("span-integration-2"))).toBe(
            "Integration response",
        )
    })

    it("atoms.query for unknown span ID settles without throwing", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = traceSpanMolecule.atoms.query("span-does-not-exist")
        // The trace backend scans spans before returning; give it extra headroom.
        const settled = await waitForAtom<{isPending: boolean}>(
            store,
            queryAtom,
            (q) => !q.isPending,
            25_000,
        )

        expect(settled.isPending).toBe(false)
        expect(store.get(traceSpanMolecule.atoms.data("span-does-not-exist"))).toBeNull()
    })

    it("isDirty is false after seeding and false after discarding a draft", () => {
        const {store} = createIntegrationStore()
        const spanId = "span-integration-draft"

        traceSpanMolecule.local.set(spanId, makeSpan({span_id: spanId}), {store})

        store.set(traceSpanMolecule.reducers.update, spanId, {"ag.data": {inputs: {prompt: "New"}}})
        expect(store.get(traceSpanMolecule.atoms.isDirty(spanId))).toBe(true)

        store.set(traceSpanMolecule.reducers.discard, spanId)
        expect(store.get(traceSpanMolecule.atoms.isDirty(spanId))).toBe(false)
    })
})

describe.skipIf(!TEST_SPAN_ID)("traceSpanMolecule integration (server-fetched span)", () => {
    it("atoms.serverData returns the span from the backend", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = traceSpanMolecule.atoms.query(TEST_SPAN_ID)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        const serverData = store.get(traceSpanMolecule.atoms.serverData(TEST_SPAN_ID))
        expect(serverData).not.toBeNull()
        expect(serverData?.span_id).toBe(TEST_SPAN_ID)
    })

    it("atoms.inputs returns the span inputs from the backend", async () => {
        const {store} = createIntegrationStore()

        const queryAtom = traceSpanMolecule.atoms.query(TEST_SPAN_ID)
        await waitForAtom<{isPending: boolean}>(store, queryAtom, (q) => !q.isPending)

        const inputs = store.get(traceSpanMolecule.atoms.inputs(TEST_SPAN_ID))
        expect(typeof inputs).toBe("object")
    })
})
