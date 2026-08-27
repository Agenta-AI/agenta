/**
 * Import smoke test — verifies that entity molecules load without error in Node.
 * Remove this file once all entities have real unit tests.
 *
 * The imports are STATIC on purpose. They used to be `await import(...)` inside each case, which
 * put the cold transform of a very large module graph inside the per-test timeout: ~22s for the
 * first one when this file runs alone, and well past 60s when it competes with the other 72 test
 * files for CPU. Raising the timeout only moves the number that fails.
 *
 * Hoisting them means vitest transforms the graph once, during collection, where no per-test
 * timeout applies. The assertion is unchanged — a module that throws on import still fails the
 * suite, as a collection error rather than a failing case.
 */
import {describe, it, expect} from "vitest"

import {environmentMolecule} from "../../../src/environment/index"
import {testcaseMolecule} from "../../../src/testcase/index"
import {revisionMolecule, testsetMolecule} from "../../../src/testset/index"
import {traceSpanMolecule} from "../../../src/trace/index"

describe("entity molecule imports (Node env smoke)", () => {
    it("testset molecule imports without throwing", () => {
        expect(testsetMolecule).toBeDefined()
        expect(revisionMolecule).toBeDefined()
    })

    it("testcase molecule imports without throwing", () => {
        expect(testcaseMolecule).toBeDefined()
    })

    it("trace molecule imports without throwing", () => {
        expect(traceSpanMolecule).toBeDefined()
    })

    it("environment molecule imports without throwing", () => {
        expect(environmentMolecule).toBeDefined()
    })
})
