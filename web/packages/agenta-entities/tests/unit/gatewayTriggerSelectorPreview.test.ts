/**
 * Unit tests for the subscription mapping selector-preview helpers.
 *
 * The subscription drawer maps workflow inputs from the event context via
 * selectors: JSONPath-lite (`$.a.b[0]`, `$["a"]`) or JSON Pointer (`/a/b/0`).
 * These pin resolution across the supported syntaxes and the best-effort
 * (never-throw) failure behavior. The backend remains the source of truth.
 */

import {describe, expect, it} from "vitest"

import {previewValue, resolveSelectorPreview} from "../../src/gatewayTrigger/core/selectorPreview"

const CONTEXT = {
    event: {
        event_id: "evt_1",
        event_type: "github.issue.opened",
        attributes: {
            repository: "acme/widgets",
            labels: ["bug", "p0"],
            author: {login: "octocat"},
        },
    },
}

describe("resolveSelectorPreview", () => {
    it("returns the whole context for the root selector", () => {
        expect(resolveSelectorPreview("$", CONTEXT)).toBe(CONTEXT)
    })

    it("resolves a dotted JSONPath", () => {
        expect(resolveSelectorPreview("$.event.event_type", CONTEXT)).toBe("github.issue.opened")
        expect(resolveSelectorPreview("$.event.attributes.author.login", CONTEXT)).toBe("octocat")
    })

    it("resolves array index in bracket form", () => {
        expect(resolveSelectorPreview("$.event.attributes.labels[0]", CONTEXT)).toBe("bug")
        expect(resolveSelectorPreview("$.event.attributes.labels[1]", CONTEXT)).toBe("p0")
    })

    it("resolves quoted bracket keys", () => {
        expect(resolveSelectorPreview('$.event["attributes"]["repository"]', CONTEXT)).toBe(
            "acme/widgets",
        )
    })

    it("resolves JSON Pointer syntax", () => {
        expect(resolveSelectorPreview("/event/event_id", CONTEXT)).toBe("evt_1")
        expect(resolveSelectorPreview("/event/attributes/labels/0", CONTEXT)).toBe("bug")
    })

    it("decodes JSON Pointer escapes (~1 -> /, ~0 -> ~)", () => {
        const data = {"a/b": {"c~d": 42}} as Record<string, unknown>
        expect(resolveSelectorPreview("/a~1b/c~0d", data)).toBe(42)
    })

    it("returns undefined for a missing path", () => {
        expect(resolveSelectorPreview("$.event.nope.deeper", CONTEXT)).toBeUndefined()
    })

    it("returns undefined for a non-integer array index", () => {
        expect(resolveSelectorPreview("$.event.attributes.labels.x", CONTEXT)).toBeUndefined()
    })

    it("returns undefined for an unsupported selector form", () => {
        expect(resolveSelectorPreview("event.event_id", CONTEXT)).toBeUndefined()
    })

    it("returns undefined when walking past a scalar", () => {
        expect(resolveSelectorPreview("$.event.event_id.deeper", CONTEXT)).toBeUndefined()
    })
})

describe("previewValue", () => {
    it("passes strings through unchanged", () => {
        expect(previewValue("hello")).toBe("hello")
    })

    it("JSON-stringifies non-strings", () => {
        expect(previewValue(42)).toBe("42")
        expect(previewValue(["a", "b"])).toBe('["a","b"]')
        expect(previewValue({k: 1})).toBe('{"k":1}')
    })
})
