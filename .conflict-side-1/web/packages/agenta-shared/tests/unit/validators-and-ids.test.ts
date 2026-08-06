import {describe, expect, it} from "vitest"

import {isValidHttpUrl, isValidRegex, isValidUUID, validateUUID} from "../../src/utils/validators"
import {uuidToSpanId, uuidToTraceId} from "../../src/utils/traceIds"
import {removeTrailingSlash} from "../../src/utils/uriUtils"

// ---------------------------------------------------------------------------
// isValidUUID
// ---------------------------------------------------------------------------

describe("isValidUUID", () => {
    it.each([
        "123e4567-e89b-12d3-a456-426614174000",
        "00000000-0000-0000-0000-000000000000",
        "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF",
    ])("returns true for valid UUID %s", (uuid) => {
        expect(isValidUUID(uuid)).toBe(true)
    })

    it.each([
        "",
        "not-a-uuid",
        "123e4567-e89b-12d3-a456",
        "123e4567-e89b-12d3-a456-42661417400Z",
        "123e4567e89b12d3a456426614174000",
    ])("returns false for invalid input %s", (input) => {
        expect(isValidUUID(input)).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// validateUUID
// ---------------------------------------------------------------------------

describe("validateUUID", () => {
    it("does not throw for a valid UUID", () => {
        expect(() => validateUUID("123e4567-e89b-12d3-a456-426614174000", "id")).not.toThrow()
    })

    it("throws with a descriptive message for an invalid UUID", () => {
        expect(() => validateUUID("not-valid", "userId")).toThrow(
            "Invalid userId: must be a valid UUID",
        )
    })
})

// ---------------------------------------------------------------------------
// isValidHttpUrl
// ---------------------------------------------------------------------------

describe("isValidHttpUrl", () => {
    it.each(["http://example.com", "https://example.com/path?q=1"])("returns true for %s", (url) =>
        expect(isValidHttpUrl(url)).toBe(true),
    )

    it.each(["ftp://example.com", "not-a-url", "", "javascript:alert(1)"])(
        "returns false for %s",
        (url) => expect(isValidHttpUrl(url)).toBe(false),
    )
})

// ---------------------------------------------------------------------------
// isValidRegex
// ---------------------------------------------------------------------------

describe("isValidRegex", () => {
    it.each(["^[a-z]+$", "\\d+", "(foo|bar)", ".*"])("returns true for valid regex %s", (re) =>
        expect(isValidRegex(re)).toBe(true),
    )

    it.each(["[invalid", "(unclosed", "*bad"])("returns false for invalid regex %s", (re) => {
        expect(isValidRegex(re)).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// uuidToTraceId
// ---------------------------------------------------------------------------

describe("uuidToTraceId", () => {
    it("strips dashes from a UUID", () => {
        expect(uuidToTraceId("123e4567-e89b-12d3-a456-426614174000")).toBe(
            "123e4567e89b12d3a456426614174000",
        )
    })

    it("returns undefined for undefined input", () => {
        expect(uuidToTraceId(undefined)).toBeUndefined()
    })

    it("returns undefined for empty string", () => {
        expect(uuidToTraceId("")).toBeUndefined()
    })
})

// ---------------------------------------------------------------------------
// uuidToSpanId
// ---------------------------------------------------------------------------

describe("uuidToSpanId", () => {
    it("returns the last 16 hex chars of the stripped UUID", () => {
        // UUID: 123e4567-e89b-12d3-a456-426614174000
        // Full hex: 123e4567e89b12d3a456426614174000  (32 chars)
        // Last 16:                  a456426614174000
        expect(uuidToSpanId("123e4567-e89b-12d3-a456-426614174000")).toBe("a456426614174000")
    })

    it("returns undefined for undefined input", () => {
        expect(uuidToSpanId(undefined)).toBeUndefined()
    })

    it("span ID length is always 16", () => {
        const spanId = uuidToSpanId("ffffffff-ffff-ffff-ffff-ffffffffffff")
        expect(spanId).toHaveLength(16)
    })
})

// ---------------------------------------------------------------------------
// removeTrailingSlash
// ---------------------------------------------------------------------------

describe("removeTrailingSlash", () => {
    it("removes a trailing slash", () => {
        expect(removeTrailingSlash("http://example.com/")).toBe("http://example.com")
    })

    it("leaves a URI without trailing slash unchanged", () => {
        expect(removeTrailingSlash("http://example.com")).toBe("http://example.com")
    })

    it("removes only the last slash, not interior ones", () => {
        expect(removeTrailingSlash("http://example.com/path/")).toBe("http://example.com/path")
    })

    it("handles empty string", () => {
        expect(removeTrailingSlash("")).toBe("")
    })
})
