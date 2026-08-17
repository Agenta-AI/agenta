/**
 * THE PERMISSION KEY CHAIN, end to end: an approval card's tool name → the config key
 * "always allow" writes → the rule the runner matches a gate against.
 *
 * Four components have to agree on one string, and nothing in the type system makes them:
 *  1. the card's name — `partToolName` off the tool part (ApprovalDock.tsx:61), built either live
 *     by the SDK egress (`_approval_tool_name`, stream.py:817-833) or on reload by
 *     `transcriptToMessages`;
 *  2. the grant key — `gateRulePattern` (toolPermission.ts:138) applied to that name VERBATIM,
 *     written into `harness.permissions.allow` by `withHarnessToolAllow`;
 *  3. the wire filter — `wire_author_permission_rules` (permission_rules.py:39) drops `mcp__`
 *     patterns on the way to the runner;
 *  4. the runner — `ruleMatches` compares the surviving pattern against `gate.toolName`
 *     (permission-plan.ts:245-268), which is `spec?.name ?? displayName` (acp-interactions.ts:878)
 *     and is stamped back onto the emitted gate as `resolvedName` (acp-interactions.ts:243).
 *
 * (4) is what makes the goldens usable as a runner oracle: the `resolvedName` recorded in each
 * fixture's `user_approval` payload IS the `gate.toolName` that run's permission gate matched on.
 * So a replayed card whose name equals `resolvedName` keys exactly what the runner reads.
 *
 * The break this pins: replay used to name a gate from the durable `tool_call` row, which under an
 * MCP-routing harness is `mcp.agenta-tools.commit_revision`. That is a different string at every
 * link — a different label, a grant key the runner can never match, and (worse) a name that walks
 * straight past the platform-op guard that exists to keep `commit_revision` always gated.
 */
import type {SessionRecord} from "@agenta/entities/session"
import {
    findGrantableHarnessTool,
    gateRulePattern,
    readHarnessAllowList,
    withHarnessToolAllow,
} from "@agenta/entity-ui/drill-in"
import {describe, expect, it} from "vitest"

import arabicPoetryRecords from "./__fixtures__/arabicPoetrySession.json"
import testRunApprovalsRecords from "./__fixtures__/testRunApprovalsSession.json"
import {partToolName} from "../../../src/model/parts"
import {transcriptToMessages} from "../../../src/assets/transcriptToMessages"

type AnyPart = Record<string, unknown>

const MCP_ROUTED_GOLDENS = [
    {name: "arabicPoetrySession", records: arabicPoetryRecords},
    {name: "testRunApprovalsSession", records: testRunApprovalsRecords},
] as const

/**
 * The runner's own gate identity per toolCallId, read from the durable `user_approval` payload:
 * `resolvedName` is the value `acp-interactions.ts:243` copies off `gate.toolName`.
 */
const runnerGateNames = (records: unknown[]): Map<string, string> => {
    const names = new Map<string, string>()
    for (const raw of records) {
        const row = raw as {session_update?: string; payload?: Record<string, unknown>}
        const payload = row.payload ?? {}
        if (row.session_update !== "interaction_request" || payload.kind !== "user_approval") {
            continue
        }
        const request = (payload.payload ?? {}) as Record<string, unknown>
        const toolCall = (request.toolCall ?? {}) as Record<string, unknown>
        const toolCallId = request.toolCallId ?? toolCall.toolCallId ?? toolCall.id
        if (typeof toolCallId === "string" && typeof toolCall.resolvedName === "string") {
            names.set(toolCallId, toolCall.resolvedName)
        }
    }
    return names
}

/**
 * Replayed tool parts that carry an approval marker, keyed by toolCallId — the parts the dock reads
 * a `toolName` off (ApprovalDock.tsx:56-66). Matched by marker rather than by `approval-requested`
 * state: an answered gate settles to its result but keeps the same name, and the name is what the
 * grant is keyed on whether the card is open now or was open then.
 */
const replayedGates = (records: unknown[]): Map<string, AnyPart> => {
    const gates = new Map<string, AnyPart>()
    for (const message of transcriptToMessages(records as SessionRecord[]) ?? []) {
        if (message.role !== "assistant") continue
        for (const raw of message.parts as unknown as AnyPart[]) {
            const approval = raw.approval as {id?: unknown} | undefined
            if (approval?.id && raw.toolCallId) gates.set(String(raw.toolCallId), raw)
        }
    }
    return gates
}

/**
 * The runner's rule matcher, mirroring `ruleMatches`/`toolNamesMatch` (permission-plan.ts:245-268)
 * for the plain-name rules the card writes: the seven Pi built-ins fold case, every other
 * author-chosen name compares exactly. Prefix rules (`Bash(git:*)`) are not reachable from the
 * card, which only ever writes a bare gate name.
 */
const PI_BUILTINS = new Set(["read", "bash", "edit", "write", "grep", "find", "ls"])
const runnerRuleMatches = (pattern: string, gateToolName: string): boolean => {
    const rule = pattern.trim().toLowerCase()
    const gate = gateToolName.trim().toLowerCase()
    if (PI_BUILTINS.has(rule) && PI_BUILTINS.has(gate)) return rule === gate
    return pattern === gateToolName
}

/** `wire_author_permission_rules` (permission_rules.py:49): `mcp__` patterns never reach the runner. */
const survivesWireFilter = (pattern: string): boolean => !pattern.startsWith("mcp__")

describe("the card's tool name is the runner's gate name", () => {
    for (const golden of MCP_ROUTED_GOLDENS) {
        it(`${golden.name}: every replayed gate is named exactly as the runner keyed it`, () => {
            const expected = runnerGateNames(golden.records)
            const gates = replayedGates(golden.records)
            expect(expected.size).toBeGreaterThan(0)
            expect([...expected.keys()].filter((id) => !gates.has(id))).toEqual([])
            for (const [toolCallId, runnerName] of expected) {
                expect(partToolName(gates.get(toolCallId) as never), toolCallId).toBe(runnerName)
            }
        })

        it(`${golden.name}: no replayed gate can write a permission key at all`, () => {
            // Every gate in these goldens is a platform op (commit_revision, test_run,
            // create_schedule), and those must stay gated forever — `gateRulePattern` returns null,
            // so the dock hides "always allow" and no key is written on either path.
            for (const [toolCallId, part] of replayedGates(golden.records)) {
                expect(gateRulePattern(partToolName(part as never)), toolCallId).toBeNull()
            }
        })
    }

    it("the pre-fix name would have escaped the platform-op guard", () => {
        // Why the name above is load-bearing rather than cosmetic. The guard matches the bare
        // platform-op name, and Codex's wrapper is `mcp.` — only Claude's `mcp__` form is rejected
        // by shape — so the harness-wrapped name produced a rule for a tool that must never be
        // auto-allowed, and one no gate can match (the runner keys `commit_revision`).
        expect(gateRulePattern("commit_revision")).toBeNull()
        const escaped = gateRulePattern("mcp.agenta-tools.commit_revision")
        expect(escaped).toBe("mcp.agenta-tools.commit_revision")
        expect(runnerRuleMatches(escaped!, "commit_revision")).toBe(false)
    })
})

describe("a granted key survives the wire and matches the gate it was granted from", () => {
    const config = {
        agent: {
            harness: {permissions: {allow: [], ask: [], deny: []}},
            tools: [],
        },
    }

    // Gate names as the card receives them, paired with the runner `gate.toolName` for the same
    // call. A Pi built-in reaches the card lower-cased (`tool-bash`) while the ACP gate reports
    // `Bash`; every other name is identical on both sides.
    const grantable: {cardName: string; gateToolName: string}[] = [
        {cardName: "bash", gateToolName: "Bash"},
        {cardName: "Terminal", gateToolName: "Terminal"},
        {cardName: "Write", gateToolName: "Write"},
    ]

    for (const {cardName, gateToolName} of grantable) {
        it(`${cardName}: grant key reaches the runner and matches gate.toolName=${gateToolName}`, () => {
            const info = findGrantableHarnessTool(config, cardName)
            expect(info).not.toBeNull()
            expect(info!.allowed).toBe(false)

            const granted = withHarnessToolAllow(config, info!.pattern, true)
            const stored = readHarnessAllowList(granted)
            expect(stored).toEqual([info!.pattern])

            const [key] = stored
            expect(survivesWireFilter(key)).toBe(true)
            expect(runnerRuleMatches(key, gateToolName)).toBe(true)
        })
    }

    it("an MCP-wrapped gate never writes a key the wire would drop", () => {
        // Claude's form is rejected at the card. Nothing else may reach the wire filter and be
        // silently discarded there — a key that vanishes between the config and the runner reads
        // as a granted permission that never takes effect.
        expect(gateRulePattern("mcp__linear__create_issue")).toBeNull()
        for (const {cardName} of grantable) {
            expect(survivesWireFilter(gateRulePattern(cardName)!)).toBe(true)
        }
    })
})
