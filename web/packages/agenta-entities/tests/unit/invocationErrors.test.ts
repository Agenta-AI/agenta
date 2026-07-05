/**
 * Unit tests for the shared invocation error helpers in
 * `@agenta/entities/shared/execution/invocationErrors`.
 *
 * These pure helpers turn two confusing failure modes into clear messages:
 * an HTML error body returned instead of JSON, and a missing invocation URL.
 */

import {describe, expect, it} from "vitest"

import {
    MISSING_INVOCATION_URL_ERROR,
    describeUnreachableService,
    isHtmlBody,
} from "../../src/shared/execution/invocationErrors"

describe("isHtmlBody", () => {
    it("detects a doctype document", () => {
        expect(isHtmlBody("<!DOCTYPE html><html><body>404</body></html>")).toBe(true)
    })

    it("detects a leading html tag, ignoring case and whitespace", () => {
        expect(isHtmlBody('\n  <HTML lang="en">')).toBe(true)
    })

    it("does not match JSON bodies", () => {
        expect(isHtmlBody('{"detail": "not found"}')).toBe(false)
    })

    it("does not match text that merely contains a tag later", () => {
        expect(isHtmlBody("error: <html> is not allowed")).toBe(false)
    })

    it("handles null, undefined, and empty input", () => {
        expect(isHtmlBody(null)).toBe(false)
        expect(isHtmlBody(undefined)).toBe(false)
        expect(isHtmlBody("")).toBe(false)
    })
})

describe("describeUnreachableService", () => {
    it("includes the url when present", () => {
        expect(describeUnreachableService("https://app/test", 404)).toBe(
            "Service unreachable at https://app/test (HTTP 404)",
        )
    })

    it("omits the url when it is empty or missing", () => {
        expect(describeUnreachableService("", 502)).toBe("Service unreachable (HTTP 502)")
        expect(describeUnreachableService(null, 502)).toBe("Service unreachable (HTTP 502)")
    })
})

describe("MISSING_INVOCATION_URL_ERROR", () => {
    it("is a stable, readable message", () => {
        expect(MISSING_INVOCATION_URL_ERROR).toMatch(/no invocation url/i)
    })
})
