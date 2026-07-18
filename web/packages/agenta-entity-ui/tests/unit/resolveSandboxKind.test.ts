/**
 * Unit tests for `resolveSandboxKind`, the pure decision behind the agent-template panel's
 * sandbox-normalization effect (useModelHarness). Regression guard for issue #5349: a brand-new
 * agent has no explicit `sandbox.kind`, and the effect must NOT write one — writing dirties the
 * pristine config into "draft mode" and surfaces a phantom `local → daytona` change in Advanced
 * settings. It should only snap an EXPLICIT value this deployment can't run to an enabled option.
 */
import {describe, expect, it} from "vitest"

import {resolveSandboxKind} from "../../src/DrillInView/SchemaControls/agentTemplate/agentTemplateUtils"

const OPTIONS = [{value: "local"}, {value: "daytona"}]

describe("resolveSandboxKind", () => {
    it("returns null for an UNSET sandbox so a new agent is not dirtied (issue #5349)", () => {
        // The bug: with local filtered out, options[0] is `daytona`, and the old effect wrote it
        // into a config that never had a sandbox — dirtying it and showing `local → daytona`.
        expect(resolveSandboxKind(null, [{value: "daytona"}])).toBeNull()
        expect(resolveSandboxKind(null, OPTIONS)).toBeNull()
    })

    it("returns null when the explicit value is already available (no spurious write)", () => {
        expect(resolveSandboxKind("local", OPTIONS)).toBeNull()
        expect(resolveSandboxKind("daytona", OPTIONS)).toBeNull()
    })

    it("snaps an explicit-but-unavailable value to the first available option", () => {
        // Saved `daytona`, but this deployment only enables `local` → correct it.
        expect(resolveSandboxKind("daytona", [{value: "local"}])).toBe("local")
    })

    it("returns null when there are no available options (nothing to snap to)", () => {
        expect(resolveSandboxKind("daytona", [])).toBeNull()
        expect(resolveSandboxKind(null, [])).toBeNull()
    })
})
