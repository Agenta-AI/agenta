// @vitest-environment jsdom
/**
 * Session follow in this browser (design D7, task 8.3): a builder `edit_agent_config` result with
 * status "committed" clears that agent's latest-revision caches and asks its open sessions to run
 * the latest-version check, once per tool call. The result is recorded in the planned shape
 * (builder-backend spec: `status`, `agent`, `revision: {id, version}`); the builder stack is not
 * on the program branch yet.
 */
import {act} from "react"

import type {UIMessage} from "ai"
import {createRoot, type Root} from "react-dom/client"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const calls = vi.hoisted(() => ({
    invalidate: vi.fn<(agentId: string) => void>(),
    check: vi.fn<(agentId: string) => void>(),
}))
vi.mock("@agenta/entities/workflow", () => ({
    invalidateAgentCommittedRevisionCache: calls.invalidate,
}))
vi.mock("@agenta/playground/state", () => ({requestLatestVersionCheck: calls.check}))

import {takeBuilderCommits} from "@/features/builder/builderCommits"
import {useFollowBuilderCommits} from "@/features/builder/useFollowBuilderCommits"
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT =
    true

/** A recorded `edit_agent_config` result, as the builder tools return it. */
const committedResult = {
    status: "committed",
    agent: {id: "agent-support-triage", name: "Support triage", slug: "support-triage"},
    revision: {id: "revision-5", version: "5"},
    message: "Shortened the greeting.",
    warnings: [],
}

const toolPart = (
    toolCallId: string,
    output: unknown,
    {type = "tool-edit_agent_config", state = "output-available"} = {},
) => ({type, toolCallId, state, input: {}, output})

const assistant = (id: string, parts: unknown[]): UIMessage =>
    ({id, role: "assistant", parts}) as UIMessage

describe("takeBuilderCommits", () => {
    it("names the agent of a committed result once", () => {
        const seen = new Set<string>()
        const message = assistant("m1", [toolPart("call-1", committedResult)])
        expect(takeBuilderCommits(message, seen)).toEqual(["agent-support-triage"])
        expect(takeBuilderCommits(message, seen)).toEqual([])
    })

    it("reads a result sent as JSON text and an MCP-prefixed tool name", () => {
        const message = assistant("m1", [
            toolPart("call-1", JSON.stringify(committedResult), {
                type: "tool-mcp__agenta-tools__edit_agent_config",
            }),
        ])
        expect(takeBuilderCommits(message, new Set())).toEqual(["agent-support-triage"])
    })

    it.each([
        ["no change", toolPart("call-1", {...committedResult, status: "no_change"})],
        ["a call still running", toolPart("call-1", undefined, {state: "input-available"})],
        ["an error", toolPart("call-1", "boom", {state: "output-error"})],
        ["another tool", toolPart("call-1", committedResult, {type: "tool-read_agent_config"})],
        ["no revision", toolPart("call-1", {...committedResult, revision: undefined})],
        ["text that is not JSON", toolPart("call-1", "Saved.")],
    ])("ignores %s", (_name, part) => {
        expect(takeBuilderCommits(assistant("m1", [part]), new Set())).toEqual([])
    })
})

describe("useFollowBuilderCommits", () => {
    let host: HTMLDivElement
    let root: Root

    const Builder = ({sessionId, messages}: {sessionId: string; messages: UIMessage[]}) => {
        useFollowBuilderCommits({sessionId, messages})
        return null
    }
    const render = (messages: UIMessage[], sessionId = "builder-chat") =>
        act(async () => root.render(<Builder sessionId={sessionId} messages={messages} />))

    beforeEach(() => {
        calls.invalidate.mockReset()
        calls.check.mockReset()
        host = document.createElement("div")
        root = createRoot(host)
    })
    afterEach(async () => {
        await act(async () => root.unmount())
    })

    it("clears the agent's caches and runs its latest-version check when the result arrives", async () => {
        const running = assistant("m1", [toolPart("call-1", undefined, {state: "input-available"})])
        await render([running])
        expect(calls.check).not.toHaveBeenCalled()

        const settled = assistant("m1", [toolPart("call-1", committedResult)])
        await render([settled])
        expect(calls.invalidate.mock.calls).toEqual([["agent-support-triage"]])
        expect(calls.check.mock.calls).toEqual([["agent-support-triage"]])

        // A later render of the same message (a streamed text part) does not ask again.
        await render([assistant("m1", [toolPart("call-1", committedResult), {type: "text"}])])
        expect(calls.check).toHaveBeenCalledOnce()
    })

    it("asks again for a second committed call", async () => {
        await render([assistant("m1", [toolPart("call-1", committedResult)])])
        await render([
            assistant("m1", [
                toolPart("call-1", committedResult),
                toolPart("call-2", {
                    ...committedResult,
                    revision: {id: "revision-6", version: "6"},
                }),
            ]),
        ])
        expect(calls.check).toHaveBeenCalledTimes(2)
    })
})
