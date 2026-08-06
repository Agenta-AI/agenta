/**
 * Import smoke test — verifies that entity molecules load without error in Node.
 * Remove this file once all entities have real unit tests.
 */
import {describe, it, expect} from "vitest"

describe("entity molecule imports (Node env smoke)", () => {
    it("testset molecule imports without throwing", async () => {
        const mod = await import("../../../src/testset/index")
        expect(mod.testsetMolecule).toBeDefined()
        expect(mod.revisionMolecule).toBeDefined()
    }, 30_000)

    it("testcase molecule imports without throwing", async () => {
        const mod = await import("../../../src/testcase/index")
        expect(mod.testcaseMolecule).toBeDefined()
    })

    it("trace molecule imports without throwing", async () => {
        const mod = await import("../../../src/trace/index")
        expect(mod.traceSpanMolecule).toBeDefined()
    })

    it("environment molecule imports without throwing", async () => {
        const mod = await import("../../../src/environment/index")
        expect(mod.environmentMolecule).toBeDefined()
    })
})
