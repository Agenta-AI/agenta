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
 * Skipped, not failed, when the fixture cannot be found, so a package extracted from the
 * monorepo still runs its own suite.
 */
import {existsSync, readFileSync} from "node:fs"
import path from "node:path"

import {describe, expect, it} from "vitest"

import {toGatewayPermissions} from "../../src/mcpEndpoint/core/policyAdapter"
import {
    effectiveToolPermission,
    resolvedNewToolPermission,
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

const root = repoRoot()
const fixturePath = root ? path.join(root, FIXTURE) : null
const ladder: {unnamedTool: string; cases: LadderCase[]} | null =
    fixturePath && existsSync(fixturePath) ? JSON.parse(readFileSync(fixturePath, "utf8")) : null

describe.skipIf(!ladder)("the shared per-tool permission ladder fixture", () => {
    it("has the cases the ladder is defined by", () => {
        expect(ladder!.cases.length).toBeGreaterThanOrEqual(7)
    })

    it.each(ladder?.cases ?? [])("reads $name the way every reader must", (ladderCase) => {
        const {policy, expected} = ladderCase

        expect(resolvedNewToolPermission(policy)).toBe(expected.newToolPermission)

        expect(effectiveToolPermission(policy, ladder!.unnamedTool).permission).toBe(
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

    it.each(ladder?.cases ?? [])(
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
