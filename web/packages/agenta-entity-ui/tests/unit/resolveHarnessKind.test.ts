/**
 * Unit tests for resolveHarnessKind — the defaulting logic that aligns the UI with the runner's
 * treatment of absent harness.kind as pi_core.
 *
 * The default is read-path only; resolveHarnessKind never writes kind back into the config.
 * Runs under @agenta/entity-ui's own vitest runner.
 */
import {describe, expect, it} from "vitest"

import {resolveHarnessKind} from "../../src/DrillInView/SchemaControls/agentTemplate/useModelHarness"

describe("resolveHarnessKind", () => {
    it("returns pi_core when harness is null", () => {
        expect(resolveHarnessKind(null)).toBe("pi_core")
    })

    it("returns pi_core when harness is undefined", () => {
        expect(resolveHarnessKind(undefined)).toBe("pi_core")
    })

    it("returns pi_core when harness.kind is absent", () => {
        expect(resolveHarnessKind({})).toBe("pi_core")
    })

    it("returns pi_core when harness.kind is undefined", () => {
        expect(resolveHarnessKind({kind: undefined})).toBe("pi_core")
    })

    it("returns pi_core when harness.kind is an empty object (edge case)", () => {
        // This covers the {harness: {}} case from the issue — the runner treats it as pi_core
        expect(resolveHarnessKind({} as {kind?: string})).toBe("pi_core")
    })

    it("does not override an explicit claude harness", () => {
        expect(resolveHarnessKind({kind: "claude"})).toBe("claude")
    })

    it("does not override an explicit openai harness", () => {
        expect(resolveHarnessKind({kind: "openai"})).toBe("openai")
    })

    it("does not override an explicit pi_agenta harness", () => {
        expect(resolveHarnessKind({kind: "pi_agenta"})).toBe("pi_agenta")
    })

    it("does not override an explicit bedrock harness", () => {
        expect(resolveHarnessKind({kind: "bedrock"})).toBe("bedrock")
    })
})