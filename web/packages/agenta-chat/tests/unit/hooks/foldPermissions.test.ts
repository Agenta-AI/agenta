/**
 * `foldPermissions` — the batch half of the approval card's auto-approve grant.
 *
 * Worth its own test because the failure is silent: every `with*` helper returns a WHOLE new
 * `parameters`, so granting N tools by calling the single-tool path N times keeps only the last
 * one. The fold has to thread each result into the next call, and these tests fail if it stops.
 */
import {readHarnessAllowList} from "@agenta/entity-ui/tool-permission"
import {describe, expect, it} from "vitest"

import {foldPermissions} from "../../../src/hooks/useAlwaysAllowTool"

const harnessConfig = () => ({harness: {permissions: {allow: [], ask: [], deny: []}}})

describe("foldPermissions", () => {
    it("lands every harness tool in one config, not just the last", () => {
        const {next, applied} = foldPermissions(harnessConfig(), ["bash", "Write", "Read"], true)

        // The rule list stores the canonical built-in name; `applied` keeps the gate name verbatim.
        expect(applied.map((entry) => entry.toolName)).toEqual(["bash", "Write", "Read"])
        expect(readHarnessAllowList(next)).toEqual(["Bash", "Write", "Read"])
    })

    it("skips a tool that can never be auto-allowed, and keeps the rest", () => {
        const {next, applied} = foldPermissions(
            harnessConfig(),
            ["bash", "commit_revision", "mcp__notion__search", "Write"],
            true,
        )

        expect(applied.map((entry) => entry.toolName)).toEqual(["bash", "Write"])
        expect(readHarnessAllowList(next)).toEqual(["Bash", "Write"])
    })

    it("collapses a repeated tool to one entry", () => {
        const {next, applied} = foldPermissions(harnessConfig(), ["bash", "bash"], true)

        expect(applied).toHaveLength(1)
        expect(readHarnessAllowList(next)).toEqual(["Bash"])
    })

    it("reverses the whole batch when allowed is false", () => {
        const {next: granted} = foldPermissions(harnessConfig(), ["bash", "Write"], true)
        const {next: revoked} = foldPermissions(granted, ["bash", "Write"], false)

        expect(readHarnessAllowList(revoked)).toEqual([])
    })

    it("applies nothing when no name is grantable", () => {
        const {applied} = foldPermissions(harnessConfig(), ["commit_revision", "test_run"], true)

        expect(applied).toEqual([])
    })
})
