import type {ToolUIPart} from "ai"
import {describe, expect, it} from "vitest"

import {activityFiles, currentStep, splitTurnActivity} from "../../../src/model/activitySteps"
import type {RenderItem} from "../../../src/model/renderModel"

const tool = (over: Partial<ToolUIPart> & {type?: string}): ToolUIPart =>
    ({
        type: "tool-read",
        toolCallId: `c${Math.random()}`,
        state: "output-available",
        ...over,
    }) as ToolUIPart

const text = (index: number, body: string, state?: string): RenderItem => ({
    kind: "part",
    index,
    part: {type: "text", text: body, ...(state ? {state} : {})} as never,
})
const reasoning = (index: number, body: string, state?: string): RenderItem => ({
    kind: "part",
    index,
    part: {type: "reasoning", text: body, ...(state ? {state} : {})} as never,
})
const tools = (index: number, parts: ToolUIPart[]): RenderItem => ({kind: "tools", index, parts})

describe("splitTurnActivity", () => {
    const messageTexts = (items: RenderItem[]) =>
        splitTurnActivity(items).messages.map((message) => message.part.text)

    it("folds reasoning and calls, and keeps the final text as a message", () => {
        const items = [reasoning(0, "plan"), tools(1, [tool({})]), text(2, "done")]
        const split = splitTurnActivity(items)
        expect(split.steps.map((s) => s.kind)).toEqual(["thought", "tool"])
        expect(split.messages).toEqual([{index: 2, part: expect.objectContaining({text: "done"})}])
    })

    it("never folds a message the agent wrote between calls", () => {
        const items = [text(0, "first I will look"), tools(1, [tool({})]), text(2, "the answer")]
        const split = splitTurnActivity(items)
        expect(split.steps.map((s) => s.kind)).toEqual(["tool"])
        expect(messageTexts(items)).toEqual(["first I will look", "the answer"])
    })

    it("shows a message even while a call or a card follows it", () => {
        const items = [text(0, "checking"), tools(1, [tool({state: "input-available"})])]
        expect(splitTurnActivity(items).steps).toHaveLength(1)
        expect(messageTexts(items)).toEqual(["checking"])
    })

    it("shows a message still being written", () => {
        expect(messageTexts([tools(0, [tool({})]), text(1, "I will now", "streaming")])).toEqual([
            "I will now",
        ])
    })

    it("skips an empty text", () => {
        expect(messageTexts([text(0, "  "), tools(1, [tool({})])])).toEqual([])
    })

    it("hides a failed call but keeps a deferred one", () => {
        const items = [
            tools(0, [
                tool({state: "output-error", errorText: "boom"} as never),
                tool({
                    state: "output-error",
                    errorText: "DEFERRED_NOT_EXECUTED: waiting on another approval",
                } as never),
            ]),
        ]
        const split = splitTurnActivity(items)
        expect(split.steps).toHaveLength(1)
    })

    it("hides housekeeping renames from the fold", () => {
        const items = [
            tools(0, [
                tool({type: "tool-__ag__rename_session", input: {title: "x"}} as never),
                tool({type: "tool-rename_agent", input: {name: "y"}} as never),
                tool({}),
            ]),
        ]
        expect(splitTurnActivity(items).steps).toHaveLength(1)
    })

    it("folds a run of writes into one step and counts their files", () => {
        const items = [
            tools(0, [
                tool({type: "tool-write", input: {file_path: "a.md"}} as never),
                tool({type: "tool-write", input: {file_path: "notes/b.md"}} as never),
                tool({type: "tool-edit", input: {file_path: "a.md"}} as never),
            ]),
        ]
        const split = splitTurnActivity(items)
        expect(split.steps).toHaveLength(1)
        expect(activityFiles(split.steps).map((f) => f.path)).toEqual(["a.md", "notes/b.md"])
    })

    it("names the step in flight", () => {
        const running = tool({state: "input-available"})
        const items = [reasoning(0, "x", "done"), tools(1, [tool({}), running])]
        const step = currentStep(splitTurnActivity(items).steps)
        expect(step?.kind).toBe("tool")
        expect(step && step.kind === "tool" ? step.part : null).toBe(running)
    })
})
