/**
 * Render-hint map (T5b) — the receive half of the `render.kind` wire guarantee.
 *
 * The load-bearing case: a NEW client tool (unknown name, e.g. an elicitation emitted by a
 * platform op) settles and must auto-resume the run WITHOUT editing CLIENT_TOOL_NAMES — its
 * sibling `data-render` part is what identifies it as a client tool. The CRITICAL regression:
 * `request_connection` with no render part (today's wire) must keep resuming by bare toolName.
 */
import {describe, expect, it} from "vitest"

import {agentShouldResumeAfterApproval} from "../../src/state/execution/agentApprovalResume"
import {canReleaseQueuedMessage, isHitlPending} from "../../src/state/execution/agentMessageQueue"
import {buildRenderMap, renderKindFor} from "../../src/state/execution/renderMap"

const renderPart = (toolCallId: string, kind: string) => ({
    type: "data-render",
    data: {toolCallId, render: {kind}},
})

describe("buildRenderMap", () => {
    it("indexes data-render parts by toolCallId", () => {
        const map = buildRenderMap([
            {type: "text"},
            renderPart("call_1", "elicitation"),
            renderPart("call_2", "connect"),
        ])
        expect(map.get("call_1")).toEqual({kind: "elicitation"})
        expect(map.get("call_2")).toEqual({kind: "connect"})
    })

    it("later re-emissions win", () => {
        const map = buildRenderMap([
            renderPart("call_1", "connect"),
            renderPart("call_1", "elicitation"),
        ])
        expect(map.get("call_1")).toEqual({kind: "elicitation"})
    })

    it("skips malformed parts (missing toolCallId, non-object render, wrong type)", () => {
        const map = buildRenderMap([
            {type: "data-render", data: {render: {kind: "elicitation"}}},
            {type: "data-render", data: {toolCallId: "call_1", render: "nope"}},
            {type: "data-render", data: "nope"},
            {type: "data-other", data: {toolCallId: "call_2", render: {kind: "x"}}},
        ])
        expect(map.size).toBe(0)
    })

    it("handles undefined parts", () => {
        expect(buildRenderMap(undefined).size).toBe(0)
    })
})

describe("renderKindFor", () => {
    it("prefers an inline render.kind over the map", () => {
        const map = buildRenderMap([renderPart("call_1", "connect")])
        expect(renderKindFor({toolCallId: "call_1", render: {kind: "elicitation"}}, map)).toBe(
            "elicitation",
        )
    })

    it("falls back to the map, and to undefined when neither carries a string kind", () => {
        const map = buildRenderMap([renderPart("call_1", "elicitation")])
        expect(renderKindFor({toolCallId: "call_1"}, map)).toBe("elicitation")
        expect(renderKindFor({toolCallId: "call_2"}, map)).toBeUndefined()
        expect(renderKindFor({toolCallId: "call_1"})).toBeUndefined()
    })
})

describe("resume predicate × render map", () => {
    const user = {id: "u1", role: "user", parts: [{type: "text", text: "hi"}]}

    const settledTool = (name: string, toolCallId: string) => ({
        type: `tool-${name}`,
        toolCallId,
        state: "output-available",
        output: {action: "accept", content: {frequency: "daily"}},
    })

    it("an unknown-named client tool resumes ONLY via its sibling data-render part", () => {
        const withRender = {
            id: "a1",
            role: "assistant",
            parts: [
                {type: "step-start"},
                settledTool("collect_schedule_params", "call_e"),
                renderPart("call_e", "elicitation"),
            ],
        }
        expect(agentShouldResumeAfterApproval({messages: [user, withRender]})).toBe(true)

        // Without the render part the predicate fails closed (ordinary server tool — no resume).
        const withoutRender = {
            id: "a1",
            role: "assistant",
            parts: [{type: "step-start"}, settledTool("collect_schedule_params", "call_e")],
        }
        expect(agentShouldResumeAfterApproval({messages: [user, withoutRender]})).toBe(false)
    })

    // CRITICAL regression: today's wire carries no render hints — the shipped connect widget
    // must keep resuming by bare toolName.
    it("request_connection with no render part still resumes by name", () => {
        const message = {
            id: "a1",
            role: "assistant",
            parts: [{type: "step-start"}, settledTool("request_connection", "call_c")],
        }
        expect(agentShouldResumeAfterApproval({messages: [user, message]})).toBe(true)
    })

    it("a pending elicitation (input-available) does not resume", () => {
        const message = {
            id: "a1",
            role: "assistant",
            parts: [
                {type: "step-start"},
                {
                    type: "tool-collect_schedule_params",
                    toolCallId: "call_e",
                    state: "input-available",
                },
                renderPart("call_e", "elicitation"),
            ],
        }
        expect(agentShouldResumeAfterApproval({messages: [user, message]})).toBe(false)
    })

    it("a data-render part after the resolved tool does not defeat the step-start resume guard", () => {
        const message = {
            id: "a1",
            role: "assistant",
            parts: [
                {type: "step-start"},
                settledTool("collect_schedule_params", "call_e"),
                renderPart("call_e", "elicitation"),
                {type: "step-start"},
                {type: "text", text: "continued"},
            ],
        }
        expect(agentShouldResumeAfterApproval({messages: [user, message]})).toBe(false)
    })
})

describe("queue gating × pending client tools (T7)", () => {
    const user = {id: "u1", role: "user", parts: [{type: "text", text: "hi"}]}

    const pendingTool = (name: string, toolCallId: string) => ({
        type: `tool-${name}`,
        toolCallId,
        state: "input-available",
        input: {message: "When?", requestedSchema: {type: "object", properties: {}}},
    })

    it("a pending elicitation (via its data-render sibling) holds the queue at status ready", () => {
        const messages = [
            user,
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    pendingTool("request_input", "call_e"),
                    renderPart("call_e", "elicitation"),
                ],
            },
        ]
        expect(isHitlPending(messages)).toBe(true)
        expect(canReleaseQueuedMessage("ready", messages)).toBe(false)
    })

    it("request_connection pending by bare toolName (no render part) also holds the queue", () => {
        const messages = [
            user,
            {
                id: "a1",
                role: "assistant",
                parts: [{type: "step-start"}, pendingTool("request_connection", "call_c")],
            },
        ]
        expect(isHitlPending(messages)).toBe(true)
        expect(canReleaseQueuedMessage("ready", messages)).toBe(false)
    })

    it("an unsettled ORDINARY server tool (no hint, unknown name) does not freeze the queue", () => {
        const messages = [
            user,
            {
                id: "a1",
                role: "assistant",
                parts: [{type: "step-start"}, pendingTool("read_file", "call_s")],
            },
        ]
        expect(isHitlPending(messages)).toBe(false)
        expect(canReleaseQueuedMessage("ready", messages)).toBe(true)
    })

    it("after settle the queue stays held for the auto-resume, then releases past step-start", () => {
        const settled = {
            type: "tool-request_input",
            toolCallId: "call_e",
            state: "output-available",
            output: {action: "accept", content: {}},
        }
        const beforeResume = [
            user,
            {
                id: "a1",
                role: "assistant",
                parts: [{type: "step-start"}, settled, renderPart("call_e", "elicitation")],
            },
        ]
        // Not HITL-pending anymore, but the imminent auto-resume still holds the release.
        expect(isHitlPending(beforeResume)).toBe(false)
        expect(canReleaseQueuedMessage("ready", beforeResume)).toBe(false)

        const afterResume = [
            user,
            {
                id: "a1",
                role: "assistant",
                parts: [
                    {type: "step-start"},
                    settled,
                    renderPart("call_e", "elicitation"),
                    {type: "step-start"},
                    {type: "text", text: "done"},
                ],
            },
        ]
        expect(canReleaseQueuedMessage("ready", afterResume)).toBe(true)
    })
})
