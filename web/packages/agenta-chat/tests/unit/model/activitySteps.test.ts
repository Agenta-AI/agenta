import type {ToolUIPart} from "ai"
import {describe, expect, it} from "vitest"

import {
    activityFiles,
    currentStep,
    endsOnClosedText,
    splitTurnActivity,
} from "../../../src/model/activitySteps"
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
    it("keeps the final text as the answer and folds everything before it", () => {
        const items = [reasoning(0, "plan"), tools(1, [tool({})]), text(2, "done")]
        const split = splitTurnActivity(items)
        expect(split.steps.map((s) => s.kind)).toEqual(["thought", "tool"])
        expect(split.answer?.text).toBe("done")
        expect(split.answerIndex).toBe(2)
    })

    it("treats text between tool calls as a thought, not an answer", () => {
        const items = [text(0, "first I will look"), tools(1, [tool({})]), text(2, "the answer")]
        const split = splitTurnActivity(items)
        expect(split.steps.map((s) => s.kind)).toEqual(["thought", "tool"])
        expect(split.answer?.text).toBe("the answer")
    })

    it("has no answer while a tool follows the last text", () => {
        const items = [text(0, "checking"), tools(1, [tool({state: "input-available"})])]
        const split = splitTurnActivity(items)
        expect(split.answer).toBeNull()
        expect(split.steps).toHaveLength(2)
    })

    it("ignores the parts the fold never shows when looking for the answer", () => {
        const data: RenderItem = {kind: "part", index: 2, part: {type: "data-render"} as never}
        const split = splitTurnActivity([tools(0, [tool({})]), text(1, "done"), data])
        expect(split.answer?.text).toBe("done")
    })

    it("keeps a text still being written in the fold, typing, until it is closed", () => {
        const open = [tools(0, [tool({})]), text(1, "I will now", "streaming")]
        const split = splitTurnActivity(open)
        expect(split.answer).toBeNull()
        expect(split.steps[1]).toMatchObject({kind: "thought", streaming: true})
        const closed = [tools(0, [tool({})]), text(1, "I will now", "done")]
        expect(splitTurnActivity(closed).answer?.text).toBe("I will now")
    })

    it("holds a just-closed text in the fold while the host asks it to", () => {
        const data: RenderItem = {kind: "part", index: 2, part: {type: "data-render"} as never}
        const items = [tools(0, [tool({})]), text(1, "done", "done"), data]
        expect(endsOnClosedText(items)).toBe(true)
        expect(endsOnClosedText([tools(0, [tool({})]), text(1, "open", "streaming")])).toBe(false)
        expect(endsOnClosedText([tools(0, [tool({})]), text(1, "adopted")])).toBe(true)
        expect(splitTurnActivity(items, {holdClosedText: true}).answer).toBeNull()
        expect(splitTurnActivity(items).answer?.text).toBe("done")
    })

    it("keeps the answer when only a hidden call follows it", () => {
        const rename = tool({type: "tool-rename_session", state: "output-available"})
        const split = splitTurnActivity([tools(0, [tool({})]), text(1, "done"), tools(2, [rename])])
        expect(split.answer?.text).toBe("done")
        expect(split.steps).toHaveLength(1)
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
