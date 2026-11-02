import type {RenderItem} from "@agenta/chat/model"
import {describe, expect, it} from "vitest"

import {isLiveTextItem, lastTextItemIndex} from "@/features/chat/markdownStream"

const text = (index: number, value = "hi"): RenderItem => ({
    kind: "part",
    index,
    part: {type: "text", text: value},
})

const reasoning = (index: number): RenderItem => ({
    kind: "part",
    index,
    part: {type: "reasoning", text: "thinking"},
})

// The tool group's `parts` are only read by the tool renderer, never by the text scan.
const tools = (index: number): RenderItem =>
    ({kind: "tools", index, parts: []}) as unknown as RenderItem

describe("lastTextItemIndex", () => {
    it("returns -1 when the turn has no text item", () => {
        expect(lastTextItemIndex([])).toBe(-1)
        expect(lastTextItemIndex([tools(0), reasoning(1)])).toBe(-1)
    })

    it("returns the array position, not the part index", () => {
        // parts: [tools@0, text@1] -> the text item sits at array position 1 with index 1,
        // but a folded run of three tool parts shifts them apart.
        const items = [tools(0), tools(1), tools(2), text(3)]
        expect(lastTextItemIndex(items)).toBe(3)
        expect(lastTextItemIndex([tools(0), text(7)])).toBe(1)
    })

    it("picks the LAST text item when a turn interleaves text and tools", () => {
        expect(lastTextItemIndex([text(0), tools(1), text(2)])).toBe(2)
    })

    it("ignores reasoning items", () => {
        expect(lastTextItemIndex([text(0), reasoning(1)])).toBe(0)
    })
})

describe("isLiveTextItem", () => {
    it("is false for every item of a settled turn", () => {
        const turn = {isStreamingTurn: false, items: [text(0), tools(1), text(2)]}
        expect(isLiveTextItem(turn, 0)).toBe(false)
        expect(isLiveTextItem(turn, 2)).toBe(false)
    })

    it("is true only for the trailing text item of a streaming turn", () => {
        const turn = {isStreamingTurn: true, items: [text(0), tools(1), text(2)]}
        expect(isLiveTextItem(turn, 0)).toBe(false)
        expect(isLiveTextItem(turn, 1)).toBe(false)
        expect(isLiveTextItem(turn, 2)).toBe(true)
    })

    it("is false when a streaming turn has no text yet", () => {
        const turn = {isStreamingTurn: true, items: [tools(0)]}
        expect(isLiveTextItem(turn, 0)).toBe(false)
        expect(isLiveTextItem(turn, -1)).toBe(false)
    })
})
