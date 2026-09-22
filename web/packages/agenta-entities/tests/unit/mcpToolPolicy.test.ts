/**
 * The per-tool MCP policy, checked against the rules the SDK enforces.
 *
 * `MCPPolicy` in sdks/python/agenta/sdk/agents/mcp/models.py is the authority; a client that
 * disagrees with it writes configurations that fail on every run of the agent rather than
 * once at save. The three that matter here: the pair is opt-in, an unlisted advertised tool
 * resolves to new_tool_permission with `ask` as the floor, and a tool an include filter hides
 * may not carry a permission at all.
 */
import {describe, expect, it} from "vitest"

import {
    effectiveToolPermission,
    isPerTool,
    isToolHidden,
    readMcpPolicy,
    resolvedNewToolPermission,
    setNewToolPermission,
    setToolPermission,
    staleToolPermissions,
    toolPermissions,
    type McpServerPolicy,
} from "../../src/mcpEndpoint/core/toolPolicy"

describe("readMcpPolicy", () => {
    it("reads the policy off an item", () => {
        expect(readMcpPolicy({policy: {permission: "allow"}})).toEqual({permission: "allow"})
    })

    it("answers with an empty policy rather than throwing on an item without one", () => {
        expect(readMcpPolicy({})).toEqual({})
        expect(readMcpPolicy(null)).toEqual({})
    })
})

describe("the per-tool pair is opt-in", () => {
    it("is off when neither field is set", () => {
        expect(isPerTool({})).toBe(false)
        expect(isPerTool({permission: "allow", tools: {mode: "all"}})).toBe(false)
    })

    it("is on as soon as either is set", () => {
        expect(isPerTool({tool_permissions: {echo: "allow"}})).toBe(true)
        expect(isPerTool({new_tool_permission: "deny"})).toBe(true)
    })

    it("drops the fields again when the last entry is removed", () => {
        const one = setToolPermission({}, "echo", "deny")
        const none = setToolPermission(one, "echo", null)

        expect(isPerTool(none)).toBe(false)
        expect(none).not.toHaveProperty("tool_permissions")
    })
})

describe("a tool whose name collides with an object's own machinery", () => {
    // Tool names arrive from the server verbatim and nothing validates them, so `__proto__` is a
    // name a server can offer. Copied into an ordinary object, `table["__proto__"] = "deny"` sets
    // the prototype instead of an entry: the denial is dropped on the way in, and the name then
    // reads back as `Object.prototype`, which is truthy and was returned as though it were a
    // permission. The policy is parsed from the wire here, because that is the only way the key
    // arrives as an own property — an object literal never creates one (D179).
    const fromWire = (json: string) => JSON.parse(json) as McpServerPolicy

    it("keeps a denial written against __proto__", () => {
        const policy = fromWire('{"tool_permissions":{"__proto__":"deny","echo":"allow"}}')

        expect(toolPermissions(policy).__proto__).toBe("deny")
        expect(effectiveToolPermission(policy, "__proto__")).toEqual({
            permission: "deny",
            source: "tool",
        })
    })

    it("does not hand back the prototype in place of a permission", () => {
        const policy = fromWire('{"tool_permissions":{"echo":"allow"}}')

        // Nothing was written against the name, so it inherits like any other unlisted tool.
        expect(effectiveToolPermission(policy, "__proto__").permission).toBe("ask")
        expect(effectiveToolPermission(policy, "__proto__").source).toBe("new")
    })
})

describe("what an unlisted advertised tool gets", () => {
    it("is nothing while the author has opted out", () => {
        expect(resolvedNewToolPermission({permission: "allow"})).toBeNull()
    })

    it("is new_tool_permission when set", () => {
        expect(
            resolvedNewToolPermission({
                tool_permissions: {echo: "allow"},
                new_tool_permission: "deny",
            }),
        ).toBe("deny")
    })

    it("floors at ask, so a tool nobody has looked at reaches a human", () => {
        expect(resolvedNewToolPermission({tool_permissions: {echo: "allow"}})).toBe("ask")
    })

    it("floors at ask when the floor is set to something this reader cannot read", () => {
        // The field name is the right one, so nothing upstream refuses the policy; only the
        // value is unreadable, and the wire type is a free-form mapping so nothing rejects it
        // either. Passing it through would put a value the SDK refuses back into a saved policy
        // and read it to the author as a decision, when it is not one (D172).
        expect(
            resolvedNewToolPermission({
                tool_permissions: {echo: "allow"},
                new_tool_permission: "ALLOW",
            } as unknown as McpServerPolicy),
        ).toBe("ask")
        expect(
            resolvedNewToolPermission({
                tool_permissions: {echo: "allow"},
                new_tool_permission: "inherit",
            } as unknown as McpServerPolicy),
        ).toBe("ask")
    })

    it("never falls back to the whole-server permission once a table is declared", () => {
        // The runner's gate gives a declared table with no floor beside it `ask` and never
        // consults the server permission: a human decides for anything the table does not
        // name. Reading `permission` here made the editor's "Inherits" label promise that an
        // `allow` server would run an unnamed tool unapproved, which is the unsafe direction
        // and not what the run does (D88).
        expect(
            resolvedNewToolPermission({tool_permissions: {echo: "allow"}, permission: "allow"}),
        ).toBe("ask")
        expect(
            resolvedNewToolPermission({tool_permissions: {echo: "allow"}, permission: "deny"}),
        ).toBe("ask")
    })

    it("still lets the author name the floor themselves", () => {
        expect(
            resolvedNewToolPermission({
                tool_permissions: {echo: "ask"},
                permission: "allow",
                new_tool_permission: "allow",
            }),
        ).toBe("allow")
    })

    it("hands the server permission back its authority when no table is declared", () => {
        // The other half, and the one that keeps a configuration written before per-tool
        // policy behaving exactly as it did: with no table, nothing per-tool is resolved and
        // the whole-server decision governs.
        expect(resolvedNewToolPermission({permission: "allow"})).toBeNull()
        expect(effectiveToolPermission({permission: "allow"}, "search")).toEqual({
            permission: "allow",
            source: "server",
        })
    })

    it("does not let a run default widen a server that has a table", () => {
        // The floor is `ask` and not "fall through", which is what stops an allow-by-default
        // run from quietly widening a server whose author wrote a per-tool table.
        const policy: McpServerPolicy = {tool_permissions: {echo: "deny"}}

        expect(effectiveToolPermission(policy, "search").permission).toBe("ask")
    })
})

describe("effectiveToolPermission", () => {
    const policy: McpServerPolicy = {
        permission: "allow",
        tool_permissions: {echo: "deny"},
        new_tool_permission: "ask",
    }

    it("reports an explicit entry as chosen", () => {
        expect(effectiveToolPermission(policy, "echo")).toEqual({
            permission: "deny",
            source: "tool",
        })
    })

    it("reports an unlisted tool as inherited from the new-tool default", () => {
        expect(effectiveToolPermission(policy, "search")).toEqual({
            permission: "ask",
            source: "new",
        })
    })

    it("inherits the new-tool floor rather than the server permission", () => {
        expect(
            effectiveToolPermission(
                {permission: "deny", tool_permissions: {echo: "allow"}},
                "search",
            ),
        ).toEqual({permission: "ask", source: "new"})
    })

    it("reports the whole-server decision while the author has opted out", () => {
        expect(effectiveToolPermission({permission: "allow"}, "echo")).toEqual({
            permission: "allow",
            source: "server",
        })
    })

    it("reports nothing decided when there is no policy at all", () => {
        expect(effectiveToolPermission({}, "echo")).toEqual({
            permission: null,
            source: "default",
        })
    })
})

describe("a tool the filter hides", () => {
    const filtered: McpServerPolicy = {tools: {mode: "include", names: ["echo"]}}

    it("is hidden, and an advertised one is not", () => {
        expect(isToolHidden(filtered, "search")).toBe(true)
        expect(isToolHidden(filtered, "echo")).toBe(false)
        expect(isToolHidden({tools: {mode: "all"}}, "search")).toBe(false)
    })

    it("cannot be given a permission, because the API refuses one", () => {
        // Refused rather than written: the SDK rejects the whole policy, so writing it would
        // break every run of the agent instead of failing once at save.
        expect(setToolPermission(filtered, "search", "allow")).toBe(filtered)
    })

    it("can still have a stale permission cleared", () => {
        // A filter narrowed after the fact strands entries for tools it now hides, and the
        // SDK rejects the whole policy for exactly those, so an agent that cannot run had no
        // way to be repaired from here (CR18).
        const stranded: McpServerPolicy = {
            tools: {mode: "include", names: ["echo"]},
            tool_permissions: {echo: "allow", search: "deny"},
        }

        expect(setToolPermission(stranded, "search", null).tool_permissions).toEqual({
            echo: "allow",
        })
    })

    it("does not block a permission on a tool the filter admits", () => {
        expect(setToolPermission(filtered, "echo", "deny").tool_permissions).toEqual({
            echo: "deny",
        })
    })
})

describe("setNewToolPermission", () => {
    it("sets and clears it", () => {
        const set = setNewToolPermission({}, "deny")
        expect(set.new_tool_permission).toBe("deny")
        expect(setNewToolPermission(set, null)).not.toHaveProperty("new_tool_permission")
    })

    it("opts in on its own, with no table", () => {
        expect(isPerTool(setNewToolPermission({}, "ask"))).toBe(true)
    })
})

describe("staleToolPermissions", () => {
    it("names entries for tools the server no longer advertises", () => {
        const policy: McpServerPolicy = {tool_permissions: {echo: "allow", gone: "deny"}}

        expect(staleToolPermissions(policy, ["echo", "search"])).toEqual(["gone"])
    })

    it("keeps them rather than pruning, so a decision survives a server blip", () => {
        // Dropping one silently would re-admit the tool under the new-tool default when the
        // server started advertising it again.
        const policy: McpServerPolicy = {tool_permissions: {gone: "deny"}}

        expect(setToolPermission(policy, "echo", "allow").tool_permissions).toEqual({
            gone: "deny",
            echo: "allow",
        })
    })
})
