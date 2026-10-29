/**
 * `groupAgentaNodes` is the seam between the wire and the renderer: these
 * pin what the API actually sends (`RenderPart`: text/button/card, one part
 * per button) rather than the speculative grouped vocabulary.
 */
import {describe, expect, it} from "vitest"

import {groupAgentaNodes} from "./types"

describe("groupAgentaNodes: the live shape", () => {
    it("a text part passes through", () => {
        expect(groupAgentaNodes([{type: "text", text: "hello"}])).toEqual([
            {type: "text", text: "hello"},
        ])
    })

    it("groups consecutive button parts into one run, each keeping its own value", () => {
        const nodes = groupAgentaNodes([
            {type: "button", id: "0", label: "Approve", value: "approve"},
            {type: "button", id: "1", label: "Deny", value: "deny"},
        ])
        expect(nodes).toEqual([
            {
                type: "button-run",
                buttons: [
                    {id: "0", label: "Approve", value: "approve"},
                    {id: "1", label: "Deny", value: "deny"},
                ],
            },
        ])
    })

    it("falls back to id when a button part carries no value", () => {
        const nodes = groupAgentaNodes([{type: "button", id: "approve", label: "Approve"}])
        expect(nodes).toEqual([
            {type: "button-run", buttons: [{id: "approve", label: "Approve", value: "approve"}]},
        ])
    })

    it("a card part carries its title, tool, and arguments", () => {
        const nodes = groupAgentaNodes([
            {type: "card", title: "Approval needed", tool: "search", arguments: {q: "cats"}},
        ])
        expect(nodes).toEqual([
            {type: "card", title: "Approval needed", tool: "search", arguments: {q: "cats"}},
        ])
    })

    it("a card followed by its buttons keeps the card separate from the run", () => {
        const nodes = groupAgentaNodes([
            {type: "card", title: "Approval needed"},
            {type: "button", id: "0", label: "Approve", value: "approve"},
            {type: "button", id: "1", label: "Deny", value: "deny"},
        ])
        expect(nodes).toEqual([
            {type: "card", title: "Approval needed"},
            {
                type: "button-run",
                buttons: [
                    {id: "0", label: "Approve", value: "approve"},
                    {id: "1", label: "Deny", value: "deny"},
                ],
            },
        ])
    })

    it("two separate runs stay separate across an intervening text part", () => {
        const nodes = groupAgentaNodes([
            {type: "button", id: "0", label: "Yes", value: "yes"},
            {type: "text", text: "or"},
            {type: "button", id: "1", label: "No", value: "no"},
        ])
        expect(nodes).toEqual([
            {type: "button-run", buttons: [{id: "0", label: "Yes", value: "yes"}]},
            {type: "text", text: "or"},
            {type: "button-run", buttons: [{id: "1", label: "No", value: "no"}]},
        ])
    })
})
