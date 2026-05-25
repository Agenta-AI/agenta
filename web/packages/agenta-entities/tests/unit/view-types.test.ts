/**
 * Unit tests for the view-types primitives in @agenta/entity-ui/view-types.
 *
 * NOTE: This test file lives in @agenta/entities because that package already
 * has a vitest runner wired up. The agenta-entity-ui package does not yet
 * ship its own test runner. The relative import below crosses the package
 * boundary deliberately to avoid:
 *   - Adding @agenta/entity-ui as a (test-time) dep of @agenta/entities,
 *     which would create a dependency cycle since entity-ui depends on
 *     entities at runtime.
 *   - Standing up a full vitest + stubs setup in agenta-entity-ui as part
 *     of this branch.
 *
 * TODO(follow-up): Move these tests into agenta-entity-ui/tests/unit/ once
 * that package gets its own vitest runner. Tracked separately from this PR.
 */
import {describe, expect, it} from "vitest"

import {
    detectFieldKind,
    detectNestedKind,
    getDefaultViewForValue,
    getViewOptions,
    isChatMessagesArray,
} from "../../../agenta-entity-ui/src/view-types/viewTypes"

describe("view-types: isChatMessagesArray", () => {
    it("detects a basic role-tagged messages array", () => {
        const messages = [
            {role: "system", content: "you are a helper"},
            {role: "user", content: "hi"},
            {role: "assistant", content: "hello!"},
        ]
        expect(isChatMessagesArray(messages)).toBe(true)
    })

    it("accepts every supported role (system/user/assistant/tool/developer/function)", () => {
        const messages = [
            {role: "system", content: "x"},
            {role: "user", content: "x"},
            {role: "assistant", content: "x"},
            {role: "tool", content: "x"},
            {role: "developer", content: "x"},
            {role: "function", content: "x"},
        ]
        expect(isChatMessagesArray(messages)).toBe(true)
    })

    it("rejects empty arrays", () => {
        expect(isChatMessagesArray([])).toBe(false)
    })

    it("rejects arrays of plain objects without role", () => {
        expect(isChatMessagesArray([{content: "x"}, {content: "y"}])).toBe(false)
    })

    it("rejects arrays with an unrecognized role on any item", () => {
        expect(
            isChatMessagesArray([
                {role: "user", content: "x"},
                {role: "bogus", content: "y"},
            ]),
        ).toBe(false)
    })

    it("rejects non-arrays (string, object, null, undefined)", () => {
        expect(isChatMessagesArray("hi")).toBe(false)
        expect(isChatMessagesArray({role: "user"})).toBe(false)
        expect(isChatMessagesArray(null)).toBe(false)
        expect(isChatMessagesArray(undefined)).toBe(false)
    })
})

describe("view-types: detectFieldKind (top-level 4-way bucketing)", () => {
    it("buckets strings, numbers, nulls into 'string'", () => {
        expect(detectFieldKind("hello")).toBe("string")
        expect(detectFieldKind(42)).toBe("string")
        expect(detectFieldKind(null)).toBe("string")
        expect(detectFieldKind(undefined)).toBe("string")
    })

    it("returns 'boolean' for booleans", () => {
        expect(detectFieldKind(true)).toBe("boolean")
        expect(detectFieldKind(false)).toBe("boolean")
    })

    it("returns 'object' for plain objects and non-message arrays", () => {
        expect(detectFieldKind({a: 1})).toBe("object")
        expect(detectFieldKind(["a", "b"])).toBe("object")
        expect(detectFieldKind([1, 2, 3])).toBe("object")
    })

    it("returns 'chat' for arrays of role-tagged messages (overrides 'object')", () => {
        expect(
            detectFieldKind([
                {role: "user", content: "hi"},
                {role: "assistant", content: "hello"},
            ]),
        ).toBe("chat")
    })

    it("keeps a JSON-shaped string as 'string' (gap-04 invariant)", () => {
        // The chip says what the value IS, not what it looks like.
        // A string that contains JSON text is still a string.
        expect(detectFieldKind('{"a":1}')).toBe("string")
    })
})

describe("view-types: detectNestedKind (precise nested 6-way)", () => {
    it("distinguishes string / number / boolean / null", () => {
        expect(detectNestedKind("x")).toBe("string")
        expect(detectNestedKind(0)).toBe("number")
        expect(detectNestedKind(true)).toBe("boolean")
        expect(detectNestedKind(null)).toBe("null")
    })

    it("distinguishes object from array (unlike detectFieldKind)", () => {
        expect(detectNestedKind({a: 1})).toBe("object")
        expect(detectNestedKind([1, 2])).toBe("array")
    })

    it("treats undefined as 'string' (matches form-widget fallback)", () => {
        // Undefined doesn't have its own widget; defaulting to string lets
        // the Input handle it gracefully.
        expect(detectNestedKind(undefined)).toBe("string")
    })
})

describe("view-types: getViewOptions (per-value dropdown options)", () => {
    it("offers Text / Markdown / JSON / YAML for strings — Text is default", () => {
        const opts = getViewOptions("hello")
        const values = opts.map((o) => o.value)
        expect(values).toEqual(["text", "markdown", "json", "yaml"])
        expect(opts[0].hint).toBe("default")
    })

    it("offers Text / JSON / YAML for booleans — Text is default", () => {
        const opts = getViewOptions(true)
        expect(opts.map((o) => o.value)).toEqual(["text", "json", "yaml"])
        expect(opts[0].hint).toBe("default")
    })

    it("offers Form / JSON / YAML for objects — Form is default", () => {
        const opts = getViewOptions({a: 1})
        expect(opts.map((o) => o.value)).toEqual(["form", "json", "yaml"])
        expect(opts[0].hint).toBe("default")
    })

    it("offers Form / JSON / YAML for non-message arrays — Form is default", () => {
        const opts = getViewOptions(["a", "b"])
        expect(opts.map((o) => o.value)).toEqual(["form", "json", "yaml"])
        expect(opts[0].hint).toBe("default")
    })

    it("offers Chat / JSON / YAML for role-tagged messages arrays — Chat is default", () => {
        const opts = getViewOptions([
            {role: "user", content: "hi"},
            {role: "assistant", content: "hello"},
        ])
        expect(opts.map((o) => o.value)).toEqual(["chat", "json", "yaml"])
        expect(opts[0].hint).toBe("default")
    })

    it("always includes JSON and YAML as fallback options", () => {
        for (const value of ["x", 42, true, null, {a: 1}, [1, 2]]) {
            const values = getViewOptions(value).map((o) => o.value)
            expect(values).toContain("json")
            expect(values).toContain("yaml")
        }
    })
})

describe("view-types: getDefaultViewForValue", () => {
    it("returns the first option from getViewOptions for known kinds", () => {
        expect(getDefaultViewForValue("hello")).toBe("text")
        expect(getDefaultViewForValue(true)).toBe("text")
        expect(getDefaultViewForValue({a: 1})).toBe("form")
        expect(getDefaultViewForValue([1])).toBe("form")
        expect(getDefaultViewForValue([{role: "user", content: "x"}])).toBe("chat")
    })

    it("treats undefined as a string-kind value (default → 'text')", () => {
        expect(getDefaultViewForValue(undefined)).toBe("text")
    })
})
