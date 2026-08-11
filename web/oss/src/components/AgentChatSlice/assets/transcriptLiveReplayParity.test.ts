/**
 * LIVE vs REPLAY parity, against the real live builder — not a stand-in for it.
 *
 * The `*.liveChunks.json` fixtures are the actual output of
 * `sdks/python/agenta/sdk/agents/adapters/vercel/stream.py:378`
 * (`agent_stream_to_vercel_stream`) run over the SAME golden record fixtures. That function
 * consumes the neutral `{"type", "data"}` agenta events the records log persists, so replaying
 * the records through it reproduces the exact Vercel UI Message Stream a live turn emits. Records
 * were split into turns on `done` and only agent-sourced rows were fed, the way the runner emits
 * one stream per turn. Regenerate with `__fixtures__/generate/build_live_chunks.py` (its docstring
 * has the exact command; it must run from `sdks/python`).
 *
 * Only tool-related chunks are kept (`tool-input-*`, `tool-output-*`, `tool-approval-request`,
 * `data-render`, `data-approval-manifest`) — text and reasoning are not where the cards break.
 *
 * `foldLiveChunks` below is the small part of `useChat` that matters here: chunks for one
 * `toolCallId` collapse into one part, last write wins. Everything else is a direct comparison.
 *
 * Both once-known divergences are settled and asserted below. Nothing here is skipped: a failure
 * is a real disagreement between what a session shows live and what it shows after a reload.
 */
import type {UIMessage} from "ai"
import {describe, expect, it} from "vitest"

import abandonedFormLive from "./__fixtures__/abandonedFormSession.liveChunks.json"
import arabicPoetryLive from "./__fixtures__/arabicPoetrySession.liveChunks.json"
import connectAndFormsLive from "./__fixtures__/connectAndFormsSession.liveChunks.json"
import {GOLDEN_SESSIONS} from "./__fixtures__/goldenSessions"
import testRunApprovalsLive from "./__fixtures__/testRunApprovalsSession.liveChunks.json"
import {transcriptToMessages} from "./transcriptToMessages"

type Chunk = Record<string, unknown>
type AnyPart = Record<string, unknown>

const LIVE_CHUNKS: Record<string, Chunk[]> = {
    abandonedFormSession: abandonedFormLive as unknown as Chunk[],
    arabicPoetrySession: arabicPoetryLive as unknown as Chunk[],
    connectAndFormsSession: connectAndFormsLive as unknown as Chunk[],
    testRunApprovalsSession: testRunApprovalsLive as unknown as Chunk[],
}

/**
 * Sessions whose harness routes platform tools over MCP (Codex names them
 * `mcp.agenta-tools.<tool>`). The known divergence only exists on this shape; the other two
 * sessions ran a harness that sends bare names and are byte-identical live vs replay.
 */
const MCP_ROUTED = new Set(["arabicPoetrySession", "testRunApprovalsSession"])

interface LivePart {
    toolCallId: string
    toolName?: unknown
    input?: unknown
    output?: unknown
    errorText?: unknown
    approvalId?: unknown
    renderKind?: unknown
}

/** The slice of `useChat` assembly that matters: one part per toolCallId, last write wins. */
const foldLiveChunks = (chunks: Chunk[]): Map<string, LivePart> => {
    const parts = new Map<string, LivePart>()
    const at = (id: string): LivePart => {
        const existing = parts.get(id)
        if (existing) return existing
        const fresh: LivePart = {toolCallId: id}
        parts.set(id, fresh)
        return fresh
    }
    for (const chunk of chunks) {
        if (chunk.type === "data-render") {
            const data = (chunk.data ?? {}) as Record<string, unknown>
            const id = data.toolCallId
            if (typeof id !== "string") continue
            at(id).renderKind = (data.render as Record<string, unknown> | undefined)?.kind
            continue
        }
        const id = chunk.toolCallId
        if (typeof id !== "string") continue
        const part = at(id)
        switch (chunk.type) {
            case "tool-input-start":
                part.toolName = chunk.toolName
                break
            case "tool-input-available":
                part.toolName = chunk.toolName
                part.input = chunk.input
                break
            case "tool-output-available":
                part.output = chunk.output
                break
            case "tool-output-error":
                part.errorText = chunk.errorText
                break
            case "tool-approval-request":
                part.approvalId = chunk.approvalId
                break
            default:
                break
        }
    }
    return parts
}

const replayParts = (messages: UIMessage[] | null) => {
    const parts = new Map<string, AnyPart>()
    const renderKinds = new Map<string, unknown>()
    for (const message of messages ?? []) {
        for (const raw of message.parts as unknown as AnyPart[]) {
            if (raw.type === "data-render") {
                const data = (raw.data ?? {}) as Record<string, unknown>
                if (typeof data.toolCallId === "string") {
                    renderKinds.set(
                        data.toolCallId,
                        (data.render as Record<string, unknown> | undefined)?.kind,
                    )
                }
                continue
            }
            if (typeof raw.toolCallId === "string") parts.set(raw.toolCallId, raw)
        }
    }
    return {parts, renderKinds}
}

const replayToolName = (part: AnyPart): string =>
    part.type === "dynamic-tool"
        ? String(part.toolName ?? "")
        : String(part.type).replace(/^tool-/, "")

/** Absent input is `null` on the wire and `undefined` on a replayed part; both read as absent. */
const normalize = (value: unknown): unknown => (value === undefined ? null : value)

/** The `{tool, server, arguments}` shape an MCP-routed harness wraps a call's arguments in. */
const isMcpEnvelope = (value: unknown): boolean =>
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as Record<string, unknown>).tool === "string" &&
    typeof (value as Record<string, unknown>).server === "string" &&
    typeof (value as Record<string, unknown>).arguments === "object"

const sessions = GOLDEN_SESSIONS.map((golden) => ({
    ...golden,
    live: foldLiveChunks(LIVE_CHUNKS[golden.name]),
    // Compared without interaction rows: the live stream has no row join either, so this is the
    // like-for-like comparison. Row settlement is covered by transcriptReplayShapeContract.test.ts.
    replay: replayParts(transcriptToMessages(golden.records)),
}))

describe("live vs replay: the same tool parts exist, keyed the same way", () => {
    for (const session of sessions) {
        it(`${session.name}: every live tool part is replayed under the same toolCallId`, () => {
            expect(session.live.size).toBeGreaterThan(0)
            const missing = [...session.live.keys()].filter((id) => !session.replay.parts.has(id))
            expect(missing).toEqual([])
        })

        it(`${session.name}: replay invents no tool part the live stream never emitted`, () => {
            const extra = [...session.replay.parts.keys()].filter((id) => !session.live.has(id))
            expect(extra).toEqual([])
        })

        it(`${session.name}: approval markers match the live \`tool-approval-request\` chunks`, () => {
            // ApprovalDock.tsx:57-58 keys the dock off `approval.id`; live carries it as the
            // `approvalId` of a strict `tool-approval-request` chunk.
            for (const [id, live] of session.live) {
                const replay = session.replay.parts.get(id)!
                const replayApprovalId = (replay.approval as {id?: unknown} | undefined)?.id
                expect(normalize(replayApprovalId), `approval marker for ${id}`).toEqual(
                    normalize(live.approvalId),
                )
            }
        })

        it(`${session.name}: \`data-render\` siblings match, so widget dispatch resolves the same`, () => {
            // registry.tsx:20-27 — `render.kind` is the primary dispatch axis on both paths.
            for (const [id, live] of session.live) {
                expect(
                    normalize(session.replay.renderKinds.get(id)),
                    `render kind for ${id}`,
                ).toEqual(normalize(live.renderKind))
            }
        })

        it(`${session.name}: tool outputs replay exactly as they streamed`, () => {
            for (const [id, live] of session.live) {
                if (live.output === undefined) continue
                expect(session.replay.parts.get(id)!.output, `output for ${id}`).toEqual(
                    live.output,
                )
            }
        })
    }
})

describe("live vs replay: full part parity where no known divergence applies", () => {
    for (const session of sessions.filter((s) => !MCP_ROUTED.has(s.name))) {
        it(`${session.name}: every part's tool name and input are byte-identical to live`, () => {
            for (const [id, live] of session.live) {
                const replay = session.replay.parts.get(id)!
                expect(replayToolName(replay), `tool name for ${id}`).toBe(live.toolName)
                expect(normalize(replay.input), `input for ${id}`).toEqual(normalize(live.input))
            }
        })
    }

    for (const session of sessions.filter((s) => MCP_ROUTED.has(s.name))) {
        it(`${session.name}: client-tool parts are identical to live (name AND input)`, () => {
            // The client-tool replay path re-stamps name and input from the `interaction_request`
            // payload (transcriptToMessages.ts:225-247), which is what the live egress does too
            // (stream.py:750-780). These are the parts the elicitation/connect widgets read.
            const clientToolIds = [...session.live.entries()].filter(
                ([, live]) => live.renderKind !== undefined,
            )
            expect(clientToolIds.length).toBeGreaterThan(0)
            for (const [id, live] of clientToolIds) {
                const replay = session.replay.parts.get(id)!
                expect(replayToolName(replay), `tool name for ${id}`).toBe(live.toolName)
                expect(normalize(replay.input), `input for ${id}`).toEqual(normalize(live.input))
            }
        })

        it(`${session.name}: gated (approval) parts replay under the live resolved tool name`, () => {
            // Live pins an approval part to the STABLE resolved name — `_approval_tool_name`
            // prefers `toolCall.resolvedName` (stream.py:817-833) and re-emits
            // `tool-input-available` under it (stream.py:711-726). Replay reads the same field in
            // the same order (`approvalToolName`), so the durable row's harness-wrapped name
            // (`mcp.agenta-tools.commit_revision`) never reaches the card. That name is not just a
            // label: `useAlwaysAllowTool` keys the "always allow" grant off it verbatim, so a
            // replayed card that used the wrapped name wrote a permission key the runner's gate
            // (`gate.toolName` = the same `resolvedName`) can never match. Pinned end to end in
            // `approvalGrantKey.test.ts`.
            const gated = [...session.live.entries()].filter(([, live]) => live.approvalId)
            expect(gated.length).toBeGreaterThan(0)
            for (const [id, live] of gated) {
                expect(replayToolName(session.replay.parts.get(id)!), `tool name for ${id}`).toBe(
                    live.toolName,
                )
            }
        })

        it(`${session.name}: gated (approval) parts carry the same input as live`, () => {
            // The bug this whole suite exists for: a replayed approval card must show the tool's
            // own arguments, the same ones the live card showed. Live re-stamps them from
            // `toolCall.rawInput` (stream.py:686-690); replay unwraps the MCP envelope off the
            // durable `tool_call` record. Same result — asserted so it stays that way.
            const gated = [...session.live.entries()].filter(([, live]) => live.approvalId)
            expect(gated.length).toBeGreaterThan(0)
            for (const [id, live] of gated) {
                expect(
                    normalize(session.replay.parts.get(id)!.input),
                    `approval input for ${id}`,
                ).toEqual(normalize(live.input))
            }
        })

        it(`${session.name}: every tool call streams the bare arguments, never the MCP envelope`, () => {
            // An MCP-routed harness wraps a call's arguments in a `{tool, server, arguments}`
            // transport envelope, and the durable records keep the wrapper. Cards read their fields
            // at the top level (`input.workflow_revision`), so an enveloped input renders as raw
            // JSON where the same call renders a card. Live used to strip it only on the gated path
            // — an ordinary call streamed the envelope, and a late ungated `tool_call` for an
            // already-gated id even overwrote the gate's bare args with it, so one call showed two
            // shapes live depending on when you looked. `_unwrap_tool_arguments` (stream.py) now
            // applies the same conservative rule as `unwrapToolArguments`
            // (transcriptToMessages.ts:123-134) on every egress path.
            const enveloped = session.records.filter((record) => {
                const input = (record.payload as {input?: unknown} | undefined)?.input
                return isMcpEnvelope(input)
            })
            // Guard: these sessions must actually exercise the unwrap, or the loop below proves
            // nothing.
            expect(enveloped.length).toBeGreaterThan(0)
            for (const [id, live] of session.live) {
                expect(isMcpEnvelope(live.input), `live envelope leaked on ${id}`).toBe(false)
                expect(normalize(session.replay.parts.get(id)!.input), `input for ${id}`).toEqual(
                    normalize(live.input),
                )
            }
        })
    }
})
