/**
 * Unit tests for the resolveHarnessKindValue function used by the model harness UI.
 *
 * These tests lock in the fallback behavior for omitted or undefined harness values and confirm
 * that explicit harness selections such as `pi_agenta` and `claude` are preserved unchanged.
 * Runs under @agenta/entity-ui's own vitest runner.
 */
import {describe, expect, it} from "vitest"

import {resolveHarnessKindValue} from "../../src/DrillInView/SchemaControls/agentTemplate/useModelHarness"

describe("resolveHarnessKindValue", () => {
    it("defaults an omitted harness kind to pi_core", () => {
        expect(resolveHarnessKindValue({})).toBe("pi_core")
        expect(resolveHarnessKindValue({kind: undefined})).toBe("pi_core")
    })

    it("preserves explicit harness kinds", () => {
        expect(resolveHarnessKindValue({kind: "pi_agenta"})).toBe("pi_agenta")
        expect(resolveHarnessKindValue({kind: "claude"})).toBe("claude")
        expect(resolveHarnessKindValue({kind: "codex"})).toBe("codex")
    })
})
