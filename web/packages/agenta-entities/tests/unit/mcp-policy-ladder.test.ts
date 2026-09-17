/**
 * The per-tool permission ladder, read from the fixture every reader of it shares.
 *
 * Three codebases resolve this ladder and each was tested only against its own restatement
 * of it, which is how D88 shipped green in all three: the editor labelled a `permission:
 * allow` server as allowing a tool its table did not name, the runner denied it, and no test
 * compared them.
 *
 * `services/runner/tests/fixtures/mcp-policy-ladder.json` states it once. This suite asserts
 * the editor's half, read through the two functions every MCP permission surface goes
 * through: `effectiveToolPermission` for one tool's decision, and `policyAdapter`'s
 * `toGatewayPermissions`, which is what the shared drawer draws its default from.
 *
 * A missing fixture fails this suite. It used to be skipped when the file could not be found,
 * so that a package extracted from the monorepo still ran its own suite — but the effect of
 * that allowance is that moving the file retires the cross-language guard without failing
 * anything (D129). An extraction has to carry the fixture or carry its own copy of the rule.
 */
import {existsSync, readFileSync} from "node:fs"
import path from "node:path"

import {describe, expect, it} from "vitest"

import {
    fromGatewayPermissions,
    toGatewayPermissions,
} from "../../src/mcpEndpoint/core/policyAdapter"
import {
    effectiveToolPermission,
    resolvedNewToolPermission,
    type McpPermission,
    type McpServerPolicy,
} from "../../src/mcpEndpoint/core/toolPolicy"

const FIXTURE = "services/runner/tests/fixtures/mcp-policy-ladder.json"

interface LadderCase {
    name: string
    policy: McpServerPolicy
    expected: {
        newToolPermission: string | null
        namedTool: {tool: string; permission: string} | null
        unnamedToolPermission: string | null
    }
}

interface MisCasedSender {
    name: string
    foreignTo: string[]
    policy?: unknown
    wire?: unknown
    expected: {mustNotResolveTo: string; tools: string[]}
}

const repoRoot = (): string | null => {
    let current = __dirname
    for (let depth = 0; depth < 12; depth++) {
        if (existsSync(path.join(current, ".git")) && existsSync(path.join(current, "services"))) {
            return current
        }
        const parent = path.dirname(current)
        if (parent === current) break
        current = parent
    }
    return null
}

// Resolved at module scope, so a missing fixture fails this file before any case claims to
// have checked the ladder. The message names the path, because the reader of it is someone
// who moved the file, and the other two readers that move with it.
const fixturePath = (): string => {
    const root = repoRoot()
    if (!root) {
        throw new Error(
            `The shared per-tool permission ladder fixture cannot be resolved: no parent of ${__dirname} ` +
                `holds both a .git and a services/ directory, so there is no root to join ${FIXTURE} to.`,
        )
    }
    const resolved = path.join(root, FIXTURE)
    if (!existsSync(resolved)) {
        throw new Error(
            `The shared per-tool permission ladder fixture is not at ${resolved}. It is the only thing ` +
                `keeping the SDK, the runner and the editor on one rule (D88), so its absence fails rather ` +
                `than skips (D129). Moving it means moving all three readers: this one, ` +
                `sdks/python/oss/tests/pytest/unit/agents/mcp/test_mcp_policy_ladder_fixture.py and ` +
                `services/runner/tests/unit/mcp-permission-intake.test.ts.`,
        )
    }
    return resolved
}

const ladder: {
    unnamedTool: string
    cases: LadderCase[]
    sendersThatMisCaseTheirFields: MisCasedSender[]
} = JSON.parse(readFileSync(fixturePath(), "utf8"))

describe("the shared per-tool permission ladder fixture", () => {
    it("has the cases the ladder is defined by", () => {
        expect(ladder.cases.length).toBeGreaterThanOrEqual(7)
    })

    it.each(ladder.cases)("reads $name the way every reader must", (ladderCase) => {
        const {policy, expected} = ladderCase

        expect(resolvedNewToolPermission(policy)).toBe(expected.newToolPermission)

        expect(effectiveToolPermission(policy, ladder.unnamedTool).permission).toBe(
            expected.unnamedToolPermission,
        )

        if (expected.namedTool) {
            const decision = effectiveToolPermission(policy, expected.namedTool.tool)
            expect(decision.permission).toBe(expected.namedTool.permission)
            // An explicit entry reads as chosen. Anything else and the drawer shows the tool as
            // inheriting a decision the author did in fact make for it.
            expect(decision.source).toBe("tool")
        }
    })

    it.each(ladder.cases)(
        "draws $name in the shared drawer as the decision an unnamed tool gets",
        (ladderCase) => {
            const {policy, expected} = ladderCase
            // The drawer's `default` is NOT the whole-server permission: it is what a tool with
            // no entry of its own ends up with. Those are the same value only while no table is
            // declared, and conflating them was D88 on this side.
            expect(toGatewayPermissions(policy).default).toBe(
                expected.unnamedToolPermission ?? "inherit",
            )
        },
    )
})

/**
 * A policy whose per-tool table this reader cannot see must not answer with the server
 * permission (issue 6917). This reader names its fields the way the SDK model does, so a policy
 * in the WIRE convention arrives with `toolPermissions` where it looks for `tool_permissions`,
 * and the table the author wrote disappears: what is left reads as a legitimate "server allow,
 * no table" policy, and every tool the table denied runs unapproved.
 *
 * The expectation is the invariant rather than a value, because two different fixes keep it:
 * refusing the shape, or reading both conventions.
 */
describe("a policy that arrives in the other convention", () => {
    const senders = (ladder.sendersThatMisCaseTheirFields ?? []).filter((sender) =>
        sender.foreignTo.includes("web"),
    )

    for (const sender of senders) {
        it(`never resolves ${sender.name} to allow`, () => {
            const policy = (sender.policy ?? sender.wire) as McpServerPolicy

            for (const tool of sender.expected.tools) {
                let decision: string | null
                try {
                    decision = effectiveToolPermission(policy, tool).permission
                } catch {
                    // Refusing the shape is one of the two ways to keep the invariant.
                    continue
                }
                expect(
                    decision,
                    `${tool} resolved from a table this reader could not see`,
                ).not.toBe(sender.expected.mustNotResolveTo)
            }
        })
    }
})

/**
 * Absence is a valid state, not an unrecognised one (decision 29).
 *
 * The refusal above keys on a per-tool field being PRESENT under the wire's name. An absent
 * `permission`, an absent table and an absent floor each keep the meaning they have always had,
 * which for the drawer is `inherit` at the server level and "inherits" per tool.
 */
describe("a policy that declares nothing is not invalid", () => {
    it("draws the server permission as the default when no table was declared", () => {
        expect(toGatewayPermissions({permission: "allow"})).toEqual({
            default: "allow",
            tools: {},
        })
        expect(effectiveToolPermission({permission: "allow"}, "any_tool_at_all")).toEqual({
            permission: "allow",
            source: "server",
        })
    })

    it("draws inherit when the policy is empty", () => {
        expect(toGatewayPermissions({})).toEqual({default: "inherit", tools: {}})
        expect(effectiveToolPermission({}, "any_tool_at_all")).toEqual({
            permission: null,
            source: "default",
        })
    })
})

/**
 * A value that is not one of the three decisions is not a decision (D172).
 *
 * The saved shape is JSON, so a table can carry another surface's spelling. Passed through, it
 * reached a control with nothing to draw it as, the row rendered empty, and the write filter,
 * which tested only for the `inherit` sentinel, put it straight back into the saved policy —
 * where the SDK model refuses the whole policy and the agent's next run fails.
 */
describe("a value that is not one of the three decisions", () => {
    const misCasedValue: McpServerPolicy = {
        permission: "allow",
        tool_permissions: {delete_repository: "Allow" as McpPermission},
    }

    it("is dropped, so the tool falls to the floor the declared table sets", () => {
        expect(effectiveToolPermission(misCasedValue, "delete_repository")).toEqual({
            permission: "ask",
            source: "new",
        })
    })

    it("leaves the table declared, so the server permission still governs nothing", () => {
        expect(resolvedNewToolPermission(misCasedValue)).toBe("ask")
        expect(toGatewayPermissions(misCasedValue)).toEqual({default: "ask", tools: {}})
    })

    it("is never written back into a saved policy", () => {
        const saved = fromGatewayPermissions(
            {default: "ask", tools: {delete_repository: "Allow" as McpPermission}},
            misCasedValue,
        )

        expect(saved.tool_permissions).toBeUndefined()
    })

    it("is not a decision at the server level either", () => {
        expect(effectiveToolPermission({permission: "Allow" as McpPermission}, "any")).toEqual({
            permission: null,
            source: "default",
        })
    })
})
