import {describe, expect, it} from "vitest"

import {applyQueueOps, pruneQueueOps, pruneQueueRowErrors} from "../../../src/assets/queueOverlay"

const rows = [
    {id: "a", text: "first", source: "server" as const},
    {id: "b", text: "second", source: "server" as const},
    {id: "c", text: "third", source: "server" as const},
]

describe("applyQueueOps", () => {
    it("hides removed and sent rows, rewrites edited ones, and flags failed ones", () => {
        const view = applyQueueOps(
            rows,
            {
                a: {kind: "remove", settledSeq: null, token: 1},
                b: {kind: "edit", text: "second, edited", settledSeq: null, token: 2},
            },
            {c: {message: "Couldn't send this message now. Try again."}},
        )
        expect(view).toEqual([
            {...rows[1], text: "second, edited", editable: false, saving: true},
            {...rows[2], error: "Couldn't send this message now. Try again."},
        ])
        expect(applyQueueOps(rows, {c: {kind: "sendNow", settledSeq: 3, token: 3}}, {})).toEqual(
            rows.slice(0, 2),
        )
        // A saved edit is sendable and editable again.
        const saved = applyQueueOps(
            rows,
            {b: {kind: "edit", text: "x", settledSeq: 2, token: 4}},
            {},
        )
        expect(saved[1]).toEqual({...rows[1], text: "x"})
    })
})

describe("pruneQueueOps", () => {
    it("keeps an op until a read that began after its write lands", () => {
        const ops = {a: {kind: "remove" as const, settledSeq: 4, token: 1}}
        expect(pruneQueueOps(ops, rows, 4)).toBe(ops)
        expect(pruneQueueOps(ops, rows, 5)).toEqual({})
        const inFlight = {a: {kind: "remove" as const, settledSeq: null, token: 2}}
        expect(pruneQueueOps(inFlight, [], 99)).toBe(inFlight)
    })

    it("keeps a sent row hidden while the server still lists it", () => {
        const ops = {a: {kind: "sendNow" as const, settledSeq: 4, token: 3}}
        expect(pruneQueueOps(ops, rows, 9)).toBe(ops)
        expect(pruneQueueOps(ops, rows.slice(1), 9)).toEqual({})
    })
})

describe("pruneQueueRowErrors", () => {
    it("drops the errors of rows that left the queue", () => {
        const errors = {a: {message: "x"}, z: {message: "y"}}
        expect(pruneQueueRowErrors(errors, rows)).toEqual({a: {message: "x"}})
        const kept = {a: {message: "x"}}
        expect(pruneQueueRowErrors(kept, rows)).toBe(kept)
    })
})
