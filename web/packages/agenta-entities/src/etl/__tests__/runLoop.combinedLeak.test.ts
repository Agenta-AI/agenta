/**
 * instrumentedAtomFamily semantics — size / remove / clear / registry.
 *
 * The combined paginatedStore + molecule-layer leak test that previously
 * lived here was relocated to `@agenta/evaluations`
 * (`tests/longrun/runLoop.combinedLeak.test.ts`) along with the eval-run
 * ETL primitives (cacheDiagnostics) it depends on: `@agenta/entities` must
 * not depend on `@agenta/evaluations`. The generic atom-family registry
 * semantics below have no eval-run coupling and stay here.
 *
 * No --expose-gc needed for these — they are pure registry-bookkeeping
 * assertions.
 */

import assert from "node:assert/strict"
import {describe, it} from "node:test"

import {atom} from "jotai"

// =============================================================================
// instrumentedAtomFamily semantics tests (no GC needed)
// =============================================================================

describe("instrumentedAtomFamily: size + remove + clear semantics", () => {
    it("tracks size as new params arrive", async () => {
        // Build a fresh instrumented family for an isolated check.
        const {instrumentedAtomFamily} =
            await import("../../shared/molecule/instrumentedAtomFamily")
        const family = instrumentedAtomFamily((id: string) => atom(id), {
            name: "test.sizeFamily",
            skipRegistry: true,
        })

        assert.equal(family.size(), 0)
        family("a")
        family("b")
        family("a") // dedup
        assert.equal(family.size(), 2)
        family("c")
        assert.equal(family.size(), 3)
    })

    it("remove() drops a single param", async () => {
        const {instrumentedAtomFamily} =
            await import("../../shared/molecule/instrumentedAtomFamily")
        const family = instrumentedAtomFamily((id: string) => atom(id), {
            name: "test.removeFamily",
            skipRegistry: true,
        })
        family("a")
        family("b")
        assert.equal(family.size(), 2)
        family.remove("a")
        assert.equal(family.size(), 1)
        assert.deepEqual(Array.from(family.params()), ["b"])
    })

    it("clear() drops everything", async () => {
        const {instrumentedAtomFamily} =
            await import("../../shared/molecule/instrumentedAtomFamily")
        const family = instrumentedAtomFamily((id: string) => atom(id), {
            name: "test.clearFamily",
            skipRegistry: true,
        })
        for (let i = 0; i < 100; i++) family(`x${i}`)
        assert.equal(family.size(), 100)
        family.clear()
        assert.equal(family.size(), 0)
    })

    it("registry surfaces named families via inspectAtomFamilies", async () => {
        const {
            instrumentedAtomFamily,
            inspectAtomFamilies,
            clearAllAtomFamilies: clearAll,
        } = await import("../../shared/molecule/instrumentedAtomFamily")
        clearAll()
        const family = instrumentedAtomFamily((id: string) => atom(id), {
            name: "test.registryFamily",
        })
        family("p1")
        family("p2")
        const stats = inspectAtomFamilies()
        const ours = stats.find((s) => s.name === "test.registryFamily")
        assert.ok(ours, "family should be in registry")
        assert.equal(ours.size, 2)
        clearAll()
    })
})
