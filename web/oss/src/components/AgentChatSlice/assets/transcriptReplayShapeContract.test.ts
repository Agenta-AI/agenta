/**
 * SHAPE CONTRACT — a replayed part must satisfy what the CARDS read.
 *
 * The live path (runner AgentEvent → `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py`
 * → `useChat`) is the reference shape: the cards were written against it. Replay
 * (`transcriptToMessages`) rebuilds the same parts from durable records plus interaction rows,
 * and has silently produced a DIFFERENT shape before — a card that renders properly live and as
 * raw JSON on reload. Every assertion here is derived from an actual read in a card component
 * and cites it, so "live shape" is enforced as a contract rather than asserted by vibes.
 *
 * The fixtures and the deliberate oss-vs-package divergences live in
 * `transcriptBuilderParity.test.ts`; this file reuses its golden set.
 */
import type {SessionInteraction, SessionRecord} from "@agenta/entities/session"
import {
    CLIENT_TOOL_DESCRIPTORS,
    CLIENT_TOOL_INTERACTION_ENDED_OUTPUT,
} from "@agenta/shared/clientTools"
import {parseElicitationPayload} from "@agenta/shared/utils"
import type {ToolUIPart, UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import {getPendingApprovals} from "../components/ApprovalDock"
import {clientToolMeta, isClientToolPart} from "../components/clientTools/meta"

import {goldenSession, rowStatesFromInteractions} from "./__fixtures__/goldenSessions"
import {canonicalToolName, partToolName} from "./toolDisplay"
import {transcriptToMessages} from "./transcriptToMessages"

type AnyPart = Record<string, unknown>

const INTERACTION_ROWS = (name: string): SessionInteraction[] => goldenSession(name).interactions

const build = (name: string): UIMessage[] => {
    const golden = goldenSession(name)
    return transcriptToMessages(golden.records, {interactionRowStates: golden.rows}) ?? []
}

const allParts = (messages: UIMessage[]): AnyPart[] =>
    messages.flatMap((m) => m.parts as unknown as AnyPart[])

const isToolLike = (p: AnyPart): boolean => typeof p.toolCallId === "string"

const partById = (messages: UIMessage[], toolCallId: string): AnyPart | undefined =>
    allParts(messages).find((p) => p.toolCallId === toolCallId)

/** The message a part belongs to — `data-render` siblings are resolved per message. */
const messageOf = (messages: UIMessage[], part: AnyPart): UIMessage | undefined =>
    messages.find((m) => (m.parts as unknown as AnyPart[]).includes(part))

/** Same key resolution the builder uses for a `client_tool` request. */
const clientToolIdOf = (payload: Record<string, unknown>): string => {
    const req = (payload.payload ?? {}) as Record<string, unknown>
    const toolCall = (req.toolCall ?? {}) as Record<string, unknown>
    return String(req.toolCallId ?? toolCall.id ?? toolCall.toolCallId ?? payload.id ?? "")
}

const interactionRequests = (records: SessionRecord[], kind: string) =>
    records
        .map((r) => (r.payload ?? {}) as Record<string, unknown>)
        .filter((p) => p.type === "interaction_request" && p.kind === kind)

const SESSIONS_WITH_ROWS = [
    "arabicPoetrySession",
    "testRunApprovalsSession",
    "connectAndFormsSession",
]

describe("replayed approval parts satisfy what ApprovalDock and its bodies read", () => {
    for (const name of SESSIONS_WITH_ROWS) {
        const rows = INTERACTION_ROWS(name).filter((r) => r.kind === "user_approval")
        if (rows.length === 0) continue

        it(`${name}: every approval row's token lands on a part as \`approval.id\``, () => {
            // ApprovalDock.tsx:57-58 — a gate with no `approval.id` is invisible to the dock, so
            // the transcript would hold an unanswerable turn forever.
            const parts = allParts(build(name))
            const approvalIds = new Set(
                parts
                    .map((p) => (p.approval as {id?: unknown} | undefined)?.id)
                    .filter((id): id is string => typeof id === "string"),
            )
            for (const row of rows) expect(approvalIds).toContain(row.token)
        })

        it(`${name}: approval parts carry a string toolCallId and a settled-or-gated state`, () => {
            // `getPendingApprovals` (ApprovalDock.tsx:55-58) needs `isToolPart` + `toolCallId` to
            // key the manifest lookup; `clientToolMeta` (meta.ts:29) reads the same field.
            const parts = allParts(build(name)).filter((p) => p.approval !== undefined)
            expect(parts.length).toBeGreaterThan(0)
            for (const p of parts) {
                expect(typeof p.toolCallId).toBe("string")
                expect(String(p.toolCallId)).not.toBe("")
                expect([
                    "approval-requested",
                    "approval-responded",
                    "output-available",
                    "output-error",
                    "output-denied",
                ]).toContain(p.state)
            }
        })

        it(`${name}: the approval body's tool key resolves to the row's tool`, () => {
            // ApprovalDock.tsx:235 — `resolveApprovalRenderer(canonicalToolName(toolName))`, and
            // the registry (approvals/registry.tsx:34-39) is keyed by the bare `commit_revision`.
            // If this drifts, the specialized card silently degrades to the raw-payload fallback.
            const messages = build(name)
            for (const row of rows) {
                const toolCallId = (row.data?.request as Record<string, unknown> | undefined)
                    ?.tool_call_id
                if (typeof toolCallId !== "string") continue
                const part = partById(messages, toolCallId)
                expect(part, `no part for ${toolCallId}`).toBeDefined()
                const expected = (row.data?.request as Record<string, unknown>).tool
                expect(canonicalToolName(partToolName(part as unknown as ToolUIPart))).toBe(
                    expected,
                )
            }
        })

        it(`${name}: approval inputs are the tool's own arguments, not the MCP envelope`, () => {
            // CommitRevisionApproval.tsx:97 reads `input.workflow_revision` at the TOP level, and
            // toolDisplay.ts:62-67 summarizes the same way. The durable `tool_call` record for an
            // MCP-routed call stores `{tool, server, arguments}`; live re-stamps the bare args
            // (stream.py:686-690, 717-726). A wrapped input renders the card as raw JSON.
            const messages = build(name)
            const expectedTopLevelKey: Record<string, string> = {
                commit_revision: "workflow_revision",
                create_schedule: "data",
                test_run: "inputs",
            }
            for (const row of rows) {
                const request = (row.data?.request ?? {}) as Record<string, unknown>
                const toolCallId = request.tool_call_id
                if (typeof toolCallId !== "string") continue
                const part = partById(messages, toolCallId)
                const input = part?.input as Record<string, unknown> | undefined
                expect(input, `no input for ${String(request.tool)}`).toBeTypeOf("object")
                expect(Object.keys(input ?? {})).not.toContain("arguments")
                expect(Object.keys(input ?? {})).not.toContain("server")
                const key = expectedTopLevelKey[String(request.tool)]
                if (key) expect(input).toHaveProperty(key)
            }
        })

        it(`${name}: pending rows stay gated and terminal rows do not`, () => {
            // `getPendingApprovals` scans for `state === "approval-requested"` across the whole
            // transcript (ApprovalDock.tsx:50-67). A terminal row left gated holds the composer.
            const messages = build(name)
            const pending = getPendingApprovals(messages).map((a) => a.approvalId)
            for (const row of rows) {
                if (row.status === "pending") expect(pending).toContain(row.token)
                else expect(pending).not.toContain(row.token)
            }
        })
    }
})

describe("replayed client-tool parts satisfy what the client-tool dispatcher reads", () => {
    for (const name of SESSIONS_WITH_ROWS.concat("abandonedFormSession")) {
        it(`${name}: every client_tool request produces a part under its own toolCallId`, () => {
            // ClientToolPart.tsx:64 stamps `data-client-tool-call-id={meta.toolCallId}` and
            // settles through it (ClientToolPart.tsx:44-58); a missing or renamed id means the
            // widget's answer never reaches the parked call.
            const golden = goldenSession(name)
            const messages = build(name)
            const requests = interactionRequests(golden.records, "client_tool")
            expect(requests.length).toBeGreaterThan(0)
            for (const payload of requests) {
                const toolCallId = clientToolIdOf(payload)
                expect(partById(messages, toolCallId), `no part for ${toolCallId}`).toBeDefined()
            }
        })

        it(`${name}: each client_tool part has its sibling data-render part in the SAME message`, () => {
            // registry.tsx:20-27 — `render.kind` is the primary dispatch axis and arrives only as
            // a sibling `data-render` part, resolved per message by `buildRenderMap`. Lose it and
            // dispatch falls back to `toolName`, and an unknown tool auto-settles as "not handled".
            const golden = goldenSession(name)
            const messages = build(name)
            const kinds = new Set([
                CLIENT_TOOL_DESCRIPTORS.connection.renderKind,
                CLIENT_TOOL_DESCRIPTORS.elicitation.renderKind,
            ])
            for (const payload of interactionRequests(golden.records, "client_tool")) {
                const req = (payload.payload ?? {}) as Record<string, unknown>
                if (!req.render) continue
                const toolCallId = clientToolIdOf(payload)
                const part = partById(messages, toolCallId)!
                const siblings = (messageOf(messages, part)?.parts ?? []) as unknown as AnyPart[]
                const render = siblings.find(
                    (p) =>
                        p.type === "data-render" &&
                        (p.data as Record<string, unknown>)?.toolCallId === toolCallId,
                )
                expect(render, `no data-render sibling for ${toolCallId}`).toBeDefined()
                const kind = (
                    (render!.data as Record<string, unknown>).render as
                        | Record<string, unknown>
                        | undefined
                )?.kind
                expect(kinds).toContain(kind)
            }
        })

        it(`${name}: client-tool parts are never mistaken for approval gates`, () => {
            // meta.ts:65-67 — `isClientToolPart` refuses a part in an approval state or carrying
            // an `approval` marker, so a client tool that picked one up renders no widget at all.
            const golden = goldenSession(name)
            const messages = build(name)
            for (const payload of interactionRequests(golden.records, "client_tool")) {
                const part = partById(messages, clientToolIdOf(payload))!
                expect(part.approval).toBeUndefined()
                expect(["approval-requested", "approval-responded"]).not.toContain(part.state)
                const meta = clientToolMeta(part as unknown as ToolUIPart)
                expect(meta.toolCallId).toBe(part.toolCallId)
                expect(meta.toolName).toBe(partToolName(part as unknown as ToolUIPart))
            }
        })
    }

    it("request_input inputs parse as elicitation payloads", () => {
        // ElicitationWidget.tsx:131 — a payload that fails `parseElicitationPayload` renders the
        // degradation card instead of the form. Covers a form answered, one still open, and one
        // abandoned, across the legacy and current record contracts.
        let checked = 0
        for (const name of SESSIONS_WITH_ROWS.concat("abandonedFormSession")) {
            const golden = goldenSession(name)
            const messages = build(name)
            for (const payload of interactionRequests(golden.records, "client_tool")) {
                const req = (payload.payload ?? {}) as Record<string, unknown>
                if (req.toolName !== CLIENT_TOOL_DESCRIPTORS.elicitation.toolName) continue
                const part = partById(messages, clientToolIdOf(payload))!
                const parsed = parseElicitationPayload(part.input)
                expect(parsed.ok, `${name}: ${parsed.ok ? "" : parsed.reason}`).toBe(true)
                checked += 1
            }
        }
        expect(checked).toBeGreaterThanOrEqual(4)
    })

    it("request_connection inputs carry the fields the connect flow keys on", () => {
        // useConnectFlow.ts:197-203 reads `integration`, `slug` and `mode` off `meta.input`; an
        // empty integration makes the widget's Connect button a no-op.
        let checked = 0
        for (const name of SESSIONS_WITH_ROWS) {
            const golden = goldenSession(name)
            const messages = build(name)
            for (const payload of interactionRequests(golden.records, "client_tool")) {
                const req = (payload.payload ?? {}) as Record<string, unknown>
                if (req.toolName !== CLIENT_TOOL_DESCRIPTORS.connection.toolName) continue
                const input = partById(messages, clientToolIdOf(payload))!.input as Record<
                    string,
                    unknown
                >
                expect(typeof input.integration).toBe("string")
                expect(input.integration).not.toBe("")
                expect(["oauth", "api_key", undefined]).toContain(input.mode)
                checked += 1
            }
        }
        expect(checked).toBeGreaterThanOrEqual(3)
    })
})

describe("interaction rows settle replayed cards the way the widgets expect", () => {
    it("a responded row replays the answer the user actually gave", () => {
        // settleClientToolPart (transcriptToMessages.ts:112-136) hands the saved output straight
        // to the widget's settled branch — ElicitationWidget.tsx:227-244 renders
        // `output.humanFriendlyMessage`, ConnectToolWidget.tsx:99-118 reads `output.connected`.
        const messages = build("connectAndFormsSession")
        const rows = INTERACTION_ROWS("connectAndFormsSession")
        const responded = rows.filter(
            (r) => r.status === "responded" && r.data?.resolution?.output !== undefined,
        )
        expect(responded.length).toBeGreaterThanOrEqual(3)
        for (const row of responded) {
            const toolCallId =
                ((row.data?.request as Record<string, unknown>)?.tool_call_id as string) ??
                row.token!
            const part = partById(messages, toolCallId)
            expect(part, `no part for ${toolCallId}`).toBeDefined()
            expect(part!.state).toBe("output-available")
            expect(part!.output).toEqual(row.data!.resolution!.output)
        }
    })

    it("a cancelled row with no saved answer settles to the NEUTRAL terminal output", () => {
        // transcriptToMessages.ts:132-135. The widgets must not invent "Dismissed" or
        // "Connection not completed" for a gate that merely died — see implementation.md anchor 6.
        const messages = build("connectAndFormsSession")
        const cancelled = INTERACTION_ROWS("connectAndFormsSession").filter(
            (r) => r.status === "cancelled" && !r.data?.resolution,
        )
        expect(cancelled.length).toBeGreaterThanOrEqual(2)
        for (const row of cancelled) {
            const part = partById(messages, row.token!)
            expect(part, `no part for ${row.token}`).toBeDefined()
            expect(part!.state).toBe("output-available")
            expect(part!.output).toEqual(CLIENT_TOOL_INTERACTION_ENDED_OUTPUT)
        }
    })

    it("a form with NO row stays open so the widget renders it again after reload", () => {
        // The abandoned-form golden: no interaction rows are joined, so the parked part must
        // survive as `input-available` and `isClientToolPart` must still route it to a widget
        // (meta.ts:57-70) rather than the transcript showing a dead card.
        const messages = transcriptToMessages(goldenSession("abandonedFormSession").records)!
        const last = messages[messages.length - 1]
        const parked = (last.parts as unknown as AnyPart[]).filter(
            (p) => isToolLike(p) && p.state === "input-available",
        )
        expect(parked.length).toBe(1)
        expect(
            isClientToolPart(parked[0] as unknown as ToolUIPart, {
                isStreaming: false,
                isLastMessage: true,
            }),
        ).toBe(true)
        expect(parseElicitationPayload(parked[0].input).ok).toBe(true)
    })

    it("legacy rows without `data.request.tool_call_id` still join by token equality", () => {
        // interactionStatus.ts:14-17 documents the legacy join. `connectAndFormsSession` holds
        // both contracts, so this proves the fallback still settles the older rows.
        const rows = INTERACTION_ROWS("connectAndFormsSession")
        const legacy = rows.filter(
            (r) => (r.data?.request as Record<string, unknown>)?.tool_call_id === undefined,
        )
        expect(legacy.length).toBeGreaterThanOrEqual(2)
        const states = rowStatesFromInteractions(rows)
        for (const row of legacy) expect(states.get(row.token!)?.toolCallId).toBeUndefined()
        const messages = build("connectAndFormsSession")
        for (const row of legacy)
            expect(partById(messages, row.token!)?.state).toBe("output-available")
    })
})

describe("KNOWN LIVE-VS-REPLAY DRIFT — awaiting a decision, do not 'fix' by editing a test", () => {
    /**
     * The live egress re-stamps a gated tool part with the STABLE resolved name
     * (`_approval_tool_name` prefers `toolCall.resolvedName`, stream.py:681 and 817-833) and
     * re-emits `tool-input-available` under it (stream.py:711-726). Replay never reads
     * `resolvedName`: an existing part keeps whatever name the durable `tool_call` carried
     * (transcriptToMessages.ts:332-347 only synthesizes a part when none exists, and then reads
     * `toolCall.name || title || kind`, which on these rows is the literal "execute").
     *
     * So for an MCP-routed harness (Codex, Claude) every approval part is named
     * `mcp.agenta-tools.commit_revision` on replay and `commit_revision` live. Both copies of the
     * builder agree, so `transcriptBuilderParity.test.ts` is green; the divergence is live-vs-replay.
     *
     * Consequences found: `resolveToolDisplay` (toolDisplay.ts:90-102) labels the replayed gate
     * "Mcp.agenta tools.commit revision" where live says "Commit revision", and that label is what
     * ApprovalDock renders (ApprovalDock.tsx:454, 581) and what `useAlwaysAllowTool.grant` puts on
     * the draft-change signal (useAlwaysAllowTool.tsx:96-127) — which routes by the RAW name, the
     * one toolDisplay.ts:49-51 warns must match the wire name verbatim.
     *
     * Unskip once Mahmoud picks the canonical name.
     */
    it.skip("DRIFT: a replayed approval part is named with the live resolved name", () => {
        const messages = build("arabicPoetrySession")
        const rows = INTERACTION_ROWS("arabicPoetrySession").filter(
            (r) => r.kind === "user_approval",
        )
        for (const row of rows) {
            const request = (row.data?.request ?? {}) as Record<string, unknown>
            const part = partById(messages, request.tool_call_id as string)!
            expect(partToolName(part as unknown as ToolUIPart)).toBe(request.tool)
        }
    })
})
