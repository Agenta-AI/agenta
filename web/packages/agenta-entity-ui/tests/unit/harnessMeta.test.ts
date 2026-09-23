import {describe, expect, it} from "vitest"

import {selectableHarnesses} from "../../src/DrillInView/SchemaControls/harnessMeta"

describe("selectableHarnesses", () => {
    it("drops the removed pi_agenta experiment and the mock test harness", () => {
        expect(selectableHarnesses(["pi_core", "claude", "codex", "mock", "pi_agenta"])).toEqual([
            "pi_core",
            "claude",
            "codex",
        ])
    })

    it("keeps unknown harness ids so a new harness shows up without a web release", () => {
        expect(selectableHarnesses(["pi_core", "gemini_cli"])).toEqual(["pi_core", "gemini_cli"])
    })
})
