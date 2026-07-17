import type {SessionRecord} from "@agenta/entities/session"
import {describe, it, expect} from "vitest"

import {transcriptToMessages} from "./transcriptToMessages"

/**
 * Regression tests for restoring a session whose turn PAUSED on a HITL approval and RESUMED.
 *
 * The bug: on reload a resolved gate showed stuck at "Awaiting approval" and the turn looked
 * duplicated. Root cause was persist-side — a paused run persisted a `done` (a false turn
 * boundary) and the resume run re-persisted the user message — so the parked gate and the
 * `tool_result` that settled it landed in different restored drafts, and the result was dropped.
 * These pin the restore side: a paused `done` is not a boundary, and tool parts settle across
 * drafts (defense-in-depth for records produced before the runner-side fixes).
 */

let seq = 0
/** Build a post-transform SessionRecord as transcriptToMessages consumes it. */
const rec = (
    sender: "user" | "agent",
    type: string,
    payload: Record<string, unknown> = {},
): SessionRecord =>
    ({
        id: `rec-${seq++}`,
        sender,
        session_update: type,
        payload: {type, ...payload},
    }) as unknown as SessionRecord

const toolPart = (m: ReturnType<typeof transcriptToMessages>, tool: string) =>
    m?.flatMap((msg) => msg.parts).find((p) => (p as {type?: string}).type === `tool-${tool}`) as
        | {state?: string; output?: unknown}
        | undefined

describe("transcriptToMessages — parked-then-resumed approval restore", () => {
    it("settles the gate and keeps ONE turn when the runner tags the paused done (both fixes)", () => {
        const messages = transcriptToMessages([
            // Run 1 (paused): user prompt, the gated Terminal, the approval gate, a PAUSED done.
            rec("user", "message", {text: "look at the agent-files folder"}),
            rec("agent", "tool_call", {id: "T", name: "Terminal"}),
            rec("agent", "interaction_request", {
                id: "E",
                kind: "user_approval",
                payload: {toolCallId: "T", toolCall: {name: "Terminal"}},
            }),
            rec("agent", "done", {stopReason: "paused"}),
            // Run 2 (resume): the Terminal executes, then the answer, then a real done.
            rec("agent", "tool_result", {id: "T", output: "README.md ..."}),
            rec("agent", "message", {text: "Hi there! I checked the folder."}),
            rec("agent", "done"),
        ])

        // One user + one assistant message — the paused done did NOT split the turn, and no
        // duplicate user turn (the resume didn't re-persist it).
        expect(messages?.map((m) => m.role)).toEqual(["user", "assistant"])
        // The gate is resolved, NOT stuck awaiting approval.
        const terminal = toolPart(messages, "Terminal")
        expect(terminal?.state).toBe("output-available")
        expect(terminal?.output).toBe("README.md ...")
        // Exactly one Terminal part — the resume's re-emit did not duplicate it.
        const terminals = messages
            ?.flatMap((m) => m.parts)
            .filter((p) => (p as {type?: string}).type === "tool-Terminal")
        expect(terminals?.length).toBe(1)
    })

    it("still settles the gate for OLD records (untagged paused done + duplicate user)", () => {
        // Defense-in-depth: records produced before the runner fixes — the paused done is untagged
        // (splits the turn) and the resume re-persisted the user message. The transcript-global
        // tool map must still let the run-2 tool_result settle the run-1 gate part.
        const messages = transcriptToMessages([
            rec("user", "message", {text: "look at the agent-files folder"}),
            rec("agent", "tool_call", {id: "T", name: "Terminal"}),
            rec("agent", "interaction_request", {
                id: "E",
                kind: "user_approval",
                payload: {toolCallId: "T", toolCall: {name: "Terminal"}},
            }),
            rec("agent", "done"), // untagged → still a boundary
            rec("user", "message", {text: "look at the agent-files folder"}), // duplicate
            rec("agent", "tool_result", {id: "T", output: "README.md ..."}),
            rec("agent", "message", {text: "Hi there!"}),
            rec("agent", "done"),
        ])

        // No part is left stuck awaiting approval — the gate settled across the draft split.
        const stuck = messages
            ?.flatMap((m) => m.parts)
            .some((p) => (p as {state?: string}).state === "approval-requested")
        expect(stuck).toBe(false)
        const terminal = toolPart(messages, "Terminal")
        expect(terminal?.state).toBe("output-available")
    })

    it("leaves a genuinely-unresumed gate awaiting approval", () => {
        // A turn that paused and was never resumed (no tool_result) must still show the gate.
        const messages = transcriptToMessages([
            rec("user", "message", {text: "do it"}),
            rec("agent", "tool_call", {id: "T", name: "Terminal"}),
            rec("agent", "interaction_request", {
                id: "E",
                kind: "user_approval",
                payload: {toolCallId: "T", toolCall: {name: "Terminal"}},
            }),
            rec("agent", "done", {stopReason: "paused"}),
        ])
        expect(toolPart(messages, "Terminal")?.state).toBe("approval-requested")
    })
})
