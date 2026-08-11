import {describe, expect, it} from "vitest"

import {
    extractApiErrorMessage,
    preserveResponseStatus,
} from "../../src/utils/extractApiErrorMessage"
import {
    stripAgentaMetadataDeep,
    stripEmptyCollectionsDeep,
    stripEnhancedWrappers,
} from "../../src/utils/valueExtraction"

// ---------------------------------------------------------------------------
// extractApiErrorMessage
// ---------------------------------------------------------------------------

describe("extractApiErrorMessage — Axios-style errors", () => {
    it("extracts from response.data.detail string", () => {
        const error = {response: {data: {detail: "Not found"}}}
        expect(extractApiErrorMessage(error)).toBe("Not found")
    })

    it("extracts from response.data.message string", () => {
        const error = {response: {data: {message: "Forbidden"}}}
        expect(extractApiErrorMessage(error)).toBe("Forbidden")
    })

    it("extracts from response.data.error string", () => {
        const error = {response: {data: {error: "Internal error"}}}
        expect(extractApiErrorMessage(error)).toBe("Internal error")
    })

    it("extracts from nested response.data.detail.message", () => {
        const error = {response: {data: {detail: {message: "Nested message"}}}}
        expect(extractApiErrorMessage(error)).toBe("Nested message")
    })

    it("extracts from an array of detail strings", () => {
        const error = {response: {data: {detail: ["error one", "error two"]}}}
        const result = extractApiErrorMessage(error)
        expect(result).toContain("error one")
    })
})

describe("extractApiErrorMessage — Error instances", () => {
    it("returns error.message for a plain Error", () => {
        expect(extractApiErrorMessage(new Error("Something failed"))).toBe("Something failed")
    })
})

describe("extractApiErrorMessage — direct string/object", () => {
    it("returns a non-empty string value directly", () => {
        expect(extractApiErrorMessage("plain error string")).toBe("plain error string")
    })

    it("falls back to String(error) for unknown shapes", () => {
        expect(extractApiErrorMessage(42)).toBe("42")
    })
})

// ---------------------------------------------------------------------------
// preserveResponseStatus
// ---------------------------------------------------------------------------

describe("preserveResponseStatus", () => {
    it("wraps an error with a custom message", () => {
        const err = preserveResponseStatus(new Error("original"), "custom message")
        expect(err.message).toBe("custom message")
    })

    it("preserves the response status from the original error", () => {
        const axiosError = {response: {status: 404}, message: "Not found"}
        const err = preserveResponseStatus(axiosError, "Not found")
        expect(err.response?.status).toBe(404)
    })

    it("preserves the original error message when no override is given", () => {
        const err = preserveResponseStatus(new Error("original"))
        expect(err.message).toBe("original")
    })
})

// ---------------------------------------------------------------------------
// stripAgentaMetadataDeep
// ---------------------------------------------------------------------------

describe("stripAgentaMetadataDeep", () => {
    it("removes agenta_metadata keys from objects", () => {
        const input = {name: "Alice", agenta_metadata: {source: "api"}}
        const result = stripAgentaMetadataDeep(input)
        expect(result).not.toHaveProperty("agenta_metadata")
        expect((result as typeof input).name).toBe("Alice")
    })

    it("removes __agenta_metadata keys from objects", () => {
        const input = {value: 1, __agenta_metadata: {}}
        expect(stripAgentaMetadataDeep(input)).not.toHaveProperty("__agenta_metadata")
    })

    it("recursively strips metadata from nested objects", () => {
        const input = {
            user: {name: "Alice", agenta_metadata: {x: 1}},
        }
        const result = stripAgentaMetadataDeep(input) as typeof input
        expect(result.user).not.toHaveProperty("agenta_metadata")
        expect(result.user.name).toBe("Alice")
    })

    it("strips metadata from objects inside arrays", () => {
        const input = [{score: 5, agenta_metadata: {}}]
        const result = stripAgentaMetadataDeep(input) as typeof input
        expect(result[0]).not.toHaveProperty("agenta_metadata")
        expect(result[0].score).toBe(5)
    })

    it("returns primitives unchanged", () => {
        expect(stripAgentaMetadataDeep("hello")).toBe("hello")
        expect(stripAgentaMetadataDeep(42)).toBe(42)
        expect(stripAgentaMetadataDeep(null)).toBeNull()
    })
})

// ---------------------------------------------------------------------------
// stripEmptyCollectionsDeep
// ---------------------------------------------------------------------------

describe("stripEmptyCollectionsDeep", () => {
    it("makes a present-but-empty array compare equal to an absent key", () => {
        // The QA repro: add then remove a skill leaves `skills: []`; it must normalize to the same
        // shape as a config that never had the key, so both sides of the dirty diff match.
        const added = {agent: {llm: {model: "opus"}, skills: []}}
        const never = {agent: {llm: {model: "opus"}}}
        expect(stripEmptyCollectionsDeep(added)).toEqual(stripEmptyCollectionsDeep(never))
        expect(stripEmptyCollectionsDeep(added)).toEqual({agent: {llm: {model: "opus"}}})
    })

    it("drops empty arrays and empty objects recursively", () => {
        expect(
            stripEmptyCollectionsDeep({tools: [], mcps: [], harness: {permissions: {}}}),
        ).toEqual({})
    })

    it("keeps non-empty collections (never hides a real change)", () => {
        const input = {agent: {tools: [{type: "web_search"}], harness: {kind: "claude"}}}
        expect(stripEmptyCollectionsDeep(input)).toEqual(input)
    })

    it("preserves array elements and order (only object keys are dropped)", () => {
        expect(stripEmptyCollectionsDeep({list: [1, 2, 3]})).toEqual({list: [1, 2, 3]})
        // Empty-object elements inside an array are preserved (dropping them would shift indices).
        expect(stripEmptyCollectionsDeep({list: [{a: 1}, {}]})).toEqual({list: [{a: 1}, {}]})
    })

    it("returns primitives and null unchanged", () => {
        expect(stripEmptyCollectionsDeep("x")).toBe("x")
        expect(stripEmptyCollectionsDeep(0)).toBe(0)
        expect(stripEmptyCollectionsDeep(null)).toBeNull()
    })
})

// ---------------------------------------------------------------------------
// stripEnhancedWrappers
// ---------------------------------------------------------------------------

describe("stripEnhancedWrappers", () => {
    it("unwraps a simple {__id, __metadata, value} wrapper", () => {
        const input = {__id: "x", __metadata: {}, value: "hello"}
        expect(stripEnhancedWrappers(input)).toBe("hello")
    })

    it("strips __id and __metadata from plain objects (non-wrapper)", () => {
        const input = {__id: "x", __metadata: {}, name: "Alice", age: 30}
        const result = stripEnhancedWrappers(input) as {name: string; age: number}
        expect(result).not.toHaveProperty("__id")
        expect(result).not.toHaveProperty("__metadata")
        expect(result.name).toBe("Alice")
        expect(result.age).toBe(30)
    })

    it("recursively strips wrappers from nested objects", () => {
        const input = {
            user: {__id: "u1", __metadata: {}, name: "Alice"},
        }
        const result = stripEnhancedWrappers(input) as {user: {name: string}}
        expect(result.user).not.toHaveProperty("__id")
        expect(result.user.name).toBe("Alice")
    })

    it("processes arrays recursively", () => {
        const input = [
            {__id: "1", __metadata: {}, value: 1},
            {__id: "2", __metadata: {}, value: 2},
        ]
        const result = stripEnhancedWrappers(input) as number[]
        expect(result).toEqual([1, 2])
    })

    it("returns null/undefined unchanged", () => {
        expect(stripEnhancedWrappers(null)).toBeNull()
        expect(stripEnhancedWrappers(undefined)).toBeUndefined()
    })

    it("returns primitives unchanged", () => {
        expect(stripEnhancedWrappers("hello")).toBe("hello")
        expect(stripEnhancedWrappers(42)).toBe(42)
    })
})
