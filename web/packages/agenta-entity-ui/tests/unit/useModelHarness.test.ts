// Tests harness-kind fallback and explicit values.
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
