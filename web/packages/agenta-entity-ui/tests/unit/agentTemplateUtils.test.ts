import {describe, expect, it} from "vitest"

import {effectiveHarnessValue} from "../../src/DrillInView/SchemaControls/agentTemplate/agentTemplateUtils"

describe("effectiveHarnessValue", () => {
    it("defaults to pi_core when harness kind is missing", () => {
        expect(effectiveHarnessValue({})).toBe("pi_core")
        expect(effectiveHarnessValue({kind: null})).toBe("pi_core")
    })

    it("preserves an explicitly selected harness", () => {
        expect(effectiveHarnessValue({kind: "pi_core"})).toBe("pi_core")
        expect(effectiveHarnessValue({kind: "pi_agenta"})).toBe("pi_agenta")
        expect(effectiveHarnessValue({kind: "claude"})).toBe("claude")
    })

    it("defaults to pi_core for a non-string kind", () => {
        expect(effectiveHarnessValue({kind: 123})).toBe("pi_core")
    })
})
