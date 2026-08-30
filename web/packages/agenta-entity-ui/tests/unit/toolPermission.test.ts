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
    readConnectionPermissions,
    readHarnessAllowList,
    withConnectionPermissions,
    withConnectionToolPermission,
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
    // (stamped as `resolvedName`). Canonicalizing an arbitrary gate would silently never match.
    it("returns a non-builtin gate name VERBATIM", () => {
        expect(gateRulePattern("Terminal")).toBe("Terminal")
        expect(gateRulePattern("terminal")).toBe("terminal")
        expect(gateRulePattern("get_weather")).toBe("get_weather")
    })

    // A built-in gate reaches the card lower-cased (the frame's part is `tool-bash`), and the
    // runner folds case for exactly these seven, so the rule is written the way the editor shows it.
    it("writes a Pi built-in under its canonical name", () => {
        expect(gateRulePattern("bash")).toBe("Bash")
        expect(gateRulePattern("Bash")).toBe("Bash")
        expect(gateRulePattern("write")).toBe("Write")
        expect(gateRulePattern("LS")).toBe("Ls")
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
        expect(findGrantableHarnessTool(wrapHarness(), "terminal")).toEqual({
            pattern: "terminal",
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

    it("routes a Pi built-in gate into the allow list under its canonical name", () => {
        // The card's "Always allow" writes `Bash` whichever spelling the gate arrived in — the
        // same rule the permissions editor offers.
        expect(findGrantableHarnessTool(wrapHarness(), "bash")).toEqual({
            pattern: "Bash",
            allowed: false,
        })
        expect(findGrantableHarnessTool(wrapHarness({allow: ["Bash"]}), "Bash")).toEqual({
            pattern: "Bash",
            allowed: true,
        })
    })

    it("reads a hand-typed built-in rule case-insensitively, as the runner matches it", () => {
        expect(findGrantableHarnessTool(wrapHarness({allow: ["bash"]}), "Bash")).toEqual({
            pattern: "Bash",
            allowed: true,
        })
        // Only the seven built-in names fold; every other rule stays case-significant.
        expect(findGrantableHarnessTool(wrapHarness({allow: ["terminal"]}), "Terminal")).toEqual({
            pattern: "Terminal",
            allowed: false,
        })
    })

    it("does not report allowed while a higher-ranked ask or deny rule matches", () => {
        expect(
            findGrantableHarnessTool(wrapHarness({allow: ["Bash"], ask: ["Bash"]}), "Bash"),
        ).toEqual({pattern: "Bash", allowed: false})
        expect(
            findGrantableHarnessTool(wrapHarness({allow: ["Bash"], deny: ["bash"]}), "Bash"),
        ).toEqual({pattern: "Bash", allowed: false})
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

    it("clears the pattern from ask and deny, which outrank allow at the runner", () => {
        const next = withHarnessToolAllow(
            wrapHarness({allow: [], ask: ["Bash", "Write"], deny: ["bash"]}),
            "Bash",
            true,
        ) as {agent: {harness: {permissions: {allow: string[]; ask: string[]; deny: string[]}}}}
        const permissions = next.agent.harness.permissions
        expect(permissions.allow).toEqual(["Bash"])
        expect(permissions.ask).toEqual(["Write"])
        expect(permissions.deny).toEqual([])
    })

    it("adds no case-variant duplicate beside a hand-typed rule", () => {
        const next = withHarnessToolAllow(wrapHarness({allow: ["bash"]}), "Bash", true) as {
            agent: {harness: {permissions: {allow: string[]}}}
        }
        expect(next.agent.harness.permissions.allow).toEqual(["bash"])
    })

    it("does not mutate the input parameters", () => {
        const params = wrapHarness({allow: ["Terminal"]})
        const snapshot = JSON.stringify(params)
        withHarnessToolAllow(params, "bash", true)
        expect(JSON.stringify(params)).toBe(snapshot)
    })
})

// ---------------------------------------------------------------------------
// F15: the connection policy write-through
// ---------------------------------------------------------------------------
//
// A `gateway_connection` entry governs a whole integration, so it is addressed by provider and
// integration rather than by a gate name. The permission drawer writes through these helpers, and
// the write must land in the draft config immediately: the run reads the draft, so the change takes
// effect on the in-flight resume and on every future run.

const GITHUB = {provider: "composio", integration: "github"}

const wrapConnection = (permissions: {
    default: string
    tools: Record<string, string>
}): Record<string, unknown> => ({
    agent: {
        tools: [
            {type: "function", function: {name: "my_tool"}},
            {
                type: "gateway_connection",
                connection: {provider: "composio", integration: "github", slug: "github-work"},
                policy: {permissions},
            },
        ],
    },
})

const connectionEntry = (parameters: unknown) =>
    ((parameters as {agent: {tools: unknown[]}}).agent.tools[1] ?? {}) as {
        connection: Record<string, unknown>
        policy: {permissions: {default: string; tools: Record<string, string>}}
    }

describe("F15: the connection policy write-through", () => {
    it("reads the saved policy of an integration's entry", () => {
        const parameters = wrapConnection({default: "deny", tools: {GET_ISSUE: "allow"}})
        expect(readConnectionPermissions(parameters, GITHUB)).toEqual({
            default: "deny",
            tools: {GET_ISSUE: "allow"},
        })
    })

    it("returns null for an integration the agent has not configured", () => {
        const parameters = wrapConnection({default: "deny", tools: {}})
        const linear = {provider: "composio", integration: "linear"}
        expect(readConnectionPermissions(parameters, linear)).toBe(null)
        expect(withConnectionToolPermission(parameters, linear, "CREATE_ISSUE", "ask")).toBe(null)
    })

    it("lands a per-tool change in the draft config immediately", () => {
        const parameters = wrapConnection({default: "inherit", tools: {}})
        const next = withConnectionToolPermission(parameters, GITHUB, "DELETE_REPOSITORY", "deny")
        expect(connectionEntry(next).policy.permissions).toEqual({
            default: "inherit",
            tools: {DELETE_REPOSITORY: "deny"},
        })
    })

    it("keeps the other tools and the default untouched", () => {
        const parameters = wrapConnection({default: "ask", tools: {GET_ISSUE: "allow"}})
        const next = withConnectionToolPermission(parameters, GITHUB, "CREATE_ISSUE", "deny")
        expect(connectionEntry(next).policy.permissions).toEqual({
            default: "ask",
            tools: {GET_ISSUE: "allow", CREATE_ISSUE: "deny"},
        })
    })

    it("removes a per-tool value that equals the current default", () => {
        const parameters = wrapConnection({
            default: "ask",
            tools: {GET_ISSUE: "allow", CREATE_ISSUE: "deny"},
        })
        const next = withConnectionToolPermission(parameters, GITHUB, "GET_ISSUE", "ask")
        expect(connectionEntry(next).policy.permissions.tools).toEqual({CREATE_ISSUE: "deny"})
    })

    it("keeps an explicit inherit value when the current default differs", () => {
        const parameters = wrapConnection({default: "deny", tools: {}})
        const next = withConnectionToolPermission(parameters, GITHUB, "GET_ISSUE", "inherit")
        expect(connectionEntry(next).policy.permissions.tools).toEqual({GET_ISSUE: "inherit"})
    })

    it("writes a whole preset, clearing the per-tool map", () => {
        const parameters = wrapConnection({default: "deny", tools: {GET_ISSUE: "allow"}})
        const next = withConnectionPermissions(parameters, GITHUB, {default: "allow", tools: {}})
        expect(connectionEntry(next).policy.permissions).toEqual({default: "allow", tools: {}})
    })

    it("keeps the connection slug and the other tools entries", () => {
        const parameters = wrapConnection({default: "deny", tools: {}})
        const next = withConnectionPermissions(parameters, GITHUB, {default: "ask", tools: {}})
        expect(connectionEntry(next).connection).toEqual({
            provider: "composio",
            integration: "github",
            slug: "github-work",
        })
        expect((next as unknown as {agent: {tools: unknown[]}}).agent.tools).toHaveLength(2)
    })

    it("does not mutate the input parameters", () => {
        const parameters = wrapConnection({default: "deny", tools: {}})
        const snapshot = JSON.stringify(parameters)
        withConnectionToolPermission(parameters, GITHUB, "GET_ISSUE", "allow")
        expect(JSON.stringify(parameters)).toBe(snapshot)
    })
})
