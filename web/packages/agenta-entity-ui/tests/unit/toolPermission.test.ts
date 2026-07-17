/**
 * Unit tests for the approval-card "always allow this tool" config write-through.
 *
 * `findGrantableTool` / `withToolPermission` map a runtime gate's wire `toolName` back to its entry
 * in the agent template's `tools[]` and set a per-tool `permission`. Only gateway (canonical or
 * legacy slug) and custom function tools are grantable; platform ops, builtins, MCP, and references
 * must be left ungrantable so `commit_revision` and destructive ops stay gated. Runs under
 * @agenta/entity-ui's own vitest runner.
 */
import {describe, expect, it} from "vitest"

import {
    findGrantableHarnessTool,
    findGrantableTool,
    gateRulePattern,
    readHarnessAllowList,
    withHarnessToolAllow,
    withToolPermission,
} from "../../src/DrillInView/SchemaControls/toolPermission"

const GATEWAY_SLUG = "tools__composio__gmail__GMAIL_SEND_EMAIL__conn1"

const canonicalGateway = (extra: Record<string, unknown> = {}) => ({
    type: "gateway",
    provider: "composio",
    integration: "gmail",
    action: "GMAIL_SEND_EMAIL",
    connection: "conn1",
    ...extra,
})

const legacyGateway = (extra: Record<string, unknown> = {}) => ({
    type: "function",
    function: {name: GATEWAY_SLUG},
    ...extra,
})

const customFn = (name: string, extra: Record<string, unknown> = {}) => ({
    type: "function",
    function: {name, parameters: {type: "object", properties: {}}},
    ...extra,
})

const wrap = (tools: unknown[]) => ({
    agent: {tools, runner: {permissions: {default: "allow_reads"}}},
})

describe("findGrantableTool", () => {
    it("matches a canonical gateway entry by its {provider,integration,action,connection} identity", () => {
        const params = wrap([canonicalGateway()])
        expect(findGrantableTool(params, GATEWAY_SLUG)).toEqual({permission: undefined})
    })

    it("matches a legacy gateway function-name slug", () => {
        const params = wrap([legacyGateway()])
        expect(findGrantableTool(params, GATEWAY_SLUG)).not.toBeNull()
    })

    it("matches a custom function tool by function.name", () => {
        const params = wrap([customFn("get_weather")])
        expect(findGrantableTool(params, "get_weather")).toEqual({permission: undefined})
    })

    it("reports the current permission when one is set", () => {
        const params = wrap([canonicalGateway({permission: "allow"})])
        expect(findGrantableTool(params, GATEWAY_SLUG)).toEqual({permission: "allow"})
    })

    it("does not match a platform op, builtin, reference, or unknown gate", () => {
        const params = wrap([
            {type: "platform", op: "commit_revision"},
            {type: "builtin", name: "read"},
            {type: "reference", name: "some_workflow"},
        ])
        expect(findGrantableTool(params, "commit_revision")).toBeNull()
        expect(findGrantableTool(params, "read")).toBeNull()
        expect(findGrantableTool(params, "mcp__linear__create_issue")).toBeNull()
    })

    it("returns null for a missing config / empty tools", () => {
        expect(findGrantableTool(null, GATEWAY_SLUG)).toBeNull()
        expect(findGrantableTool(wrap([]), GATEWAY_SLUG)).toBeNull()
    })
})

describe("withToolPermission", () => {
    it("sets permission on the matched entry and leaves the others untouched", () => {
        const other = customFn("keep_me")
        const params = wrap([canonicalGateway(), other])
        const next = withToolPermission(params, GATEWAY_SLUG, "allow") as {
            agent: {tools: Record<string, unknown>[]}
        }
        expect(next.agent.tools[0].permission).toBe("allow")
        expect(next.agent.tools[1]).toEqual(other)
    })

    it("removes the permission key when inheriting (undefined)", () => {
        const params = wrap([canonicalGateway({permission: "allow"})])
        const next = withToolPermission(params, GATEWAY_SLUG, undefined) as {
            agent: {tools: Record<string, unknown>[]}
        }
        expect("permission" in next.agent.tools[0]).toBe(false)
    })

    it("returns null (no write) for an ungrantable gate", () => {
        const params = wrap([{type: "platform", op: "commit_revision"}])
        expect(withToolPermission(params, "commit_revision", "allow")).toBeNull()
    })

    it("does not mutate the input parameters", () => {
        const params = wrap([canonicalGateway()])
        const snapshot = JSON.stringify(params)
        withToolPermission(params, GATEWAY_SLUG, "allow")
        expect(JSON.stringify(params)).toBe(snapshot)
    })

    it("supports a bare template (no agent wrapper)", () => {
        const bare = {tools: [canonicalGateway()]}
        const next = withToolPermission(bare, GATEWAY_SLUG, "allow") as {
            tools: Record<string, unknown>[]
        }
        expect(next.tools[0].permission).toBe("allow")
    })
})

const wrapHarness = (permissions?: Record<string, unknown>) => ({
    agent: {
        tools: [],
        runner: {permissions: {default: "allow_reads"}},
        harness: {kind: "pi_agenta", ...(permissions ? {permissions} : {})},
    },
})

describe("gateRulePattern", () => {
    // The runner matches `pattern === gate.toolName`, and the card shows that exact string
    // (stamped as `resolvedName`). Canonicalizing would silently never match — an ACP gate
    // reports `bash`/`Terminal` verbatim, so a rule for `Bash` would be a no-op.
    it("returns the gate name VERBATIM — never canonicalized", () => {
        expect(gateRulePattern("bash")).toBe("bash")
        expect(gateRulePattern("Terminal")).toBe("Terminal")
        expect(gateRulePattern("Bash")).toBe("Bash")
        expect(gateRulePattern("Write")).toBe("Write")
    })

    it("refuses platform ops so commit/destructive ops always gate", () => {
        expect(gateRulePattern("commit_revision")).toBeNull()
        expect(gateRulePattern("create_schedule")).toBeNull()
        expect(gateRulePattern("remove_subscription")).toBeNull()
        expect(gateRulePattern("test_run")).toBeNull()
    })

    it("refuses client tools and MCP tools (mcp__ rules are dropped from the runner plan)", () => {
        expect(gateRulePattern("request_connection")).toBeNull()
        expect(gateRulePattern("request_input")).toBeNull()
        expect(gateRulePattern("mcp__linear__create_issue")).toBeNull()
        expect(gateRulePattern("")).toBeNull()
    })
})

describe("findGrantableHarnessTool", () => {
    it("classifies an arbitrary harness gate verbatim and reports not-yet-allowed", () => {
        expect(findGrantableHarnessTool(wrapHarness(), "Terminal")).toEqual({
            pattern: "Terminal",
            allowed: false,
        })
        expect(findGrantableHarnessTool(wrapHarness(), "bash")).toEqual({
            pattern: "bash",
            allowed: false,
        })
    })

    it("reports allowed when the pattern is in harness.permissions.allow", () => {
        const params = wrapHarness({allow: ["Terminal"]})
        expect(findGrantableHarnessTool(params, "Terminal")).toEqual({
            pattern: "Terminal",
            allowed: true,
        })
        expect(readHarnessAllowList(params)).toEqual(["Terminal"])
    })

    it("returns null for a platform op", () => {
        expect(findGrantableHarnessTool(wrapHarness(), "commit_revision")).toBeNull()
    })
})

describe("withHarnessToolAllow", () => {
    it("adds the pattern to harness.permissions.allow (creating the slice)", () => {
        const next = withHarnessToolAllow(wrapHarness(), "Terminal", true) as {
            agent: {harness: {permissions: {allow: string[]}}}
        }
        expect(next.agent.harness.permissions.allow).toEqual(["Terminal"])
    })

    it("is idempotent — no duplicate when already present", () => {
        const next = withHarnessToolAllow(wrapHarness({allow: ["bash"]}), "bash", true) as {
            agent: {harness: {permissions: {allow: string[]}}}
        }
        expect(next.agent.harness.permissions.allow).toEqual(["bash"])
    })

    it("removes the pattern when allowed is false, preserving other entries", () => {
        const next = withHarnessToolAllow(
            wrapHarness({allow: ["bash", "Terminal"]}),
            "bash",
            false,
        ) as {agent: {harness: {permissions: {allow: string[]}}}}
        expect(next.agent.harness.permissions.allow).toEqual(["Terminal"])
    })

    it("preserves other permission keys (e.g. default_mode)", () => {
        const next = withHarnessToolAllow(wrapHarness({default_mode: "default"}), "Bash", true) as {
            agent: {harness: {permissions: Record<string, unknown>}}
        }
        expect(next.agent.harness.permissions.default_mode).toBe("default")
        expect(next.agent.harness.permissions.allow).toEqual(["Bash"])
    })

    it("does not mutate the input parameters", () => {
        const params = wrapHarness({allow: ["Terminal"]})
        const snapshot = JSON.stringify(params)
        withHarnessToolAllow(params, "bash", true)
        expect(JSON.stringify(params)).toBe(snapshot)
    })
})
