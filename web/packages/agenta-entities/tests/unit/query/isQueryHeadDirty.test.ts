import {describe, it, expect} from "vitest"

import {isQueryHeadDirty} from "../../../src/query/state/molecule"

const server = {
    id: "rev1",
    name: "test-3",
    data: {filtering: {conditions: [{field: "trace_type", operator: "is", value: "invocation"}]}},
} as never

describe("isQueryHeadDirty (semantic draft diff)", () => {
    it("is not dirty when there is no draft", () => {
        expect(isQueryHeadDirty(server, null)).toBe(false)
    })

    it("is not dirty when the draft equals the server values", () => {
        const draft = {
            name: "test-3",
            data: {filtering: {conditions: server.data.filtering.conditions}},
        }
        expect(isQueryHeadDirty(server, draft as never)).toBe(false)
    })

    it("is not dirty when filtering matches but key order differs (order-insensitive)", () => {
        const draft = {
            data: {
                filtering: {
                    conditions: [{value: "invocation", operator: "is", field: "trace_type"}],
                },
            },
        }
        expect(isQueryHeadDirty(server, draft as never)).toBe(false)
    })

    it("is dirty when the name changes", () => {
        expect(isQueryHeadDirty(server, {name: "renamed"} as never)).toBe(true)
    })

    it("is dirty when the filter changes", () => {
        const draft = {
            data: {
                filtering: {
                    conditions: [{field: "trace_type", operator: "is", value: "completion"}],
                },
            },
        }
        expect(isQueryHeadDirty(server, draft as never)).toBe(true)
    })

    it("is clean again when a changed value is reverted", () => {
        // Draft round-tripped back to the server values must read as not dirty,
        // unlike a `draft !== null` check.
        const reverted = {name: server.name, data: {filtering: server.data.filtering}}
        expect(isQueryHeadDirty(server, reverted as never)).toBe(false)
    })
})
