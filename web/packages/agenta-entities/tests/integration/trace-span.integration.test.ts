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
 *   - Tests that only need a backend connection are gated behind the
 *     standard hasBackend flag.
 *
 * What is tested here vs Layer 1:
 *   Layer 1 — pure atom logic (draft, merge, isDirty, getAgDataPath)
 *   Layer 2 — verifying that atoms.query falls back gracefully
 *              when a span is not in the backend.
 *
 * Coverage:
 *   • atoms.query for an unknown span ID           — settles without throwing
 *   • Server-fetched span (if AGENTA_TEST_TRACE_SPAN_ID is set)
 */

import {describe, it, expect} from "vitest"

import {traceSpanMolecule} from "../../src/trace"

import {hasBackend} from "./helpers/env"
import {createIntegrationStore, waitForAtom} from "./helpers/store"

const TEST_SPAN_ID = process.env.AGENTA_TEST_TRACE_SPAN_ID || ""

describe.skipIf(!hasBackend)("traceSpanMolecule integration (real QueryClient)", () => {
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
