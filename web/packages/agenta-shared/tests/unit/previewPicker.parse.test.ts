import {describe, expect, it} from "vitest"

import {parsePickerMessage} from "../../src/previewPicker"

const frame = {width: 800, height: 600}
const rect = {top: 10, left: 20, width: 100, height: 30}
const picked = (
    overrides: Record<string, unknown> = {},
    element: Record<string, unknown> = {},
) => ({
    type: "picked",
    element: {
        selector: "#x",
        tag: "h2",
        page: 2,
        openTag: '<h2 id="x">',
        point: {x: 0.25, y: 1},
        ...element,
    },
    text: "Hi",
    rect,
    ...overrides,
})

describe("parsePickerMessage", () => {
    it("accepts a valid picked message", () => {
        expect(parsePickerMessage(picked(), frame)).toEqual({
            type: "picked",
            element: {
                selector: "#x",
                tag: "h2",
                page: 2,
                openTag: '<h2 id="x">',
                point: {x: 0.25, y: 1},
            },
            text: "Hi",
            rect: {top: 10, left: 20, width: 100, height: 30},
        })
    })

    it("accepts pick-cancel and drops extra fields", () => {
        expect(parsePickerMessage({type: "pick-cancel", extra: 1}, frame)).toEqual({
            type: "pick-cancel",
        })
    })

    it("keeps a pin rect scrolled outside the frame; null stays null", () => {
        expect(
            parsePickerMessage(
                {
                    type: "pin-rects",
                    rects: [
                        {id: "a", rect},
                        {id: "b", rect: null},
                        {id: "c", rect: {top: 900, left: 0, width: 10, height: 10}},
                    ],
                },
                frame,
            ),
        ).toEqual({
            type: "pin-rects",
            rects: [
                {id: "a", rect: {top: 10, left: 20, width: 100, height: 30}},
                {id: "b", rect: null},
                {id: "c", rect: {top: 900, left: 0, width: 10, height: 10}},
            ],
        })
    })

    it.each([
        ["an oversized selector", picked({}, {selector: "a".repeat(501)})],
        ["an oversized openTag", picked({}, {openTag: "<".repeat(301)})],
        ["an oversized tag", picked({}, {tag: "t".repeat(41)})],
        ["an oversized text", picked({text: "t".repeat(2001)})],
        ["a NaN rect value", picked({rect: {...rect, top: Number.NaN}})],
        ["an infinite point", picked({}, {point: {x: Infinity, y: 0}})],
        ["page 0", picked({}, {page: 0})],
        ["a fractional page", picked({}, {page: 1.5})],
        ["point 1.5", picked({}, {point: {x: 1.5, y: 0}})],
        ["a negative width", picked({rect: {...rect, width: -1}})],
        ["a rect outside the frame", picked({rect: {top: 700, left: 0, width: 10, height: 10}})],
        ["a missing text", picked({text: undefined})],
        ["an unknown type", {type: "pick-start", format: "html"}],
        ["a non-object", "picked"],
    ])("rejects %s", (_label, message) => {
        expect(parsePickerMessage(message, frame)).toBeNull()
    })

    it("rejects pin-rects over 200 entries and oversized ids", () => {
        const many = Array.from({length: 201}, (_, i) => ({id: String(i), rect: null}))
        expect(parsePickerMessage({type: "pin-rects", rects: many}, frame)).toBeNull()
        expect(
            parsePickerMessage(
                {type: "pin-rects", rects: [{id: "i".repeat(101), rect: null}]},
                frame,
            ),
        ).toBeNull()
    })

    it("accepts a zero-size rect at the frame origin", () => {
        const zero = {top: 0, left: 0, width: 0, height: 0}
        expect(parsePickerMessage(picked({rect: zero}), frame)).toMatchObject({
            type: "picked",
            rect: zero,
        })
    })
})
