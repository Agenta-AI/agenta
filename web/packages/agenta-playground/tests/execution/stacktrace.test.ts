/**
 * Unit tests for the stacktrace extraction and normalisation introduced to fix
 * issue #3324 (misleading error message in evaluation table).
 *
 * Two concerns:
 *  1. parseHttpErrorBody — extracts message + stacktrace from the Python SDK's
 *     `status` envelope and FastAPI's `detail` field.
 *  2. normalizeStacktrace — coerces string | string[] | undefined to a plain
 *     string (joining frames with "\n") for storage in the evaluation API.
 */

import {describe, it, expect} from "vitest"

import {parseHttpErrorBody, normalizeStacktrace} from "@agenta/playground/utils/parseHttpError"

// ─── parseHttpErrorBody ───────────────────────────────────────────────────────

describe("parseHttpErrorBody", () => {
    // Python SDK normalizer always wraps errors in { status: { message, stacktrace } }
    describe("status branch — Python SDK envelope", () => {
        it("extracts message and string stacktrace", () => {
            const body = JSON.stringify({
                status: {
                    message: "Too many requests",
                    stacktrace: "Traceback (most recent call last):\n  File app.py\nRateLimitError\n",
                },
            })
            const result = parseHttpErrorBody(body)
            expect(result.message).toBe("Too many requests")
            expect(result.stacktrace).toBe(
                "Traceback (most recent call last):\n  File app.py\nRateLimitError\n",
            )
        })

        it("extracts message and stacktrace array (format_exception returns list[str])", () => {
            const frames = [
                "Traceback (most recent call last):\n",
                '  File "app.py", line 42, in invoke\n',
                "openai.RateLimitError: Rate limit exceeded\n",
            ]
            const body = JSON.stringify({status: {message: "Rate limit exceeded", stacktrace: frames}})
            const result = parseHttpErrorBody(body)
            expect(result.message).toBe("Rate limit exceeded")
            expect(result.stacktrace).toEqual(frames)
        })

        it("extracts message only when stacktrace is absent", () => {
            const body = JSON.stringify({status: {message: "Unauthorized"}})
            const result = parseHttpErrorBody(body)
            expect(result.message).toBe("Unauthorized")
            expect(result.stacktrace).toBeUndefined()
        })

        it("treats null stacktrace as absent", () => {
            const body = JSON.stringify({status: {message: "Error", stacktrace: null}})
            const result = parseHttpErrorBody(body)
            expect(result.stacktrace).toBeUndefined()
        })
    })

    // FastAPI validation errors and custom handlers use { detail: ... }
    describe("detail branch — FastAPI / generic errors", () => {
        it("extracts message and stacktrace from a detail object", () => {
            const body = JSON.stringify({
                detail: {
                    message: "Model not found",
                    stacktrace: "KeyError: 'gpt-99'",
                },
            })
            const result = parseHttpErrorBody(body)
            expect(result.message).toBe("Model not found")
            expect(result.stacktrace).toBe("KeyError: 'gpt-99'")
        })

        it("extracts message from a plain string detail", () => {
            const body = JSON.stringify({detail: "Not Found"})
            const result = parseHttpErrorBody(body)
            expect(result.message).toBe("Not Found")
            expect(result.stacktrace).toBeUndefined()
        })
    })

    // Edge / fallback cases
    describe("fallback handling", () => {
        it("uses raw text as message when body is not valid JSON", () => {
            const result = parseHttpErrorBody("upstream connection timeout")
            expect(result.message).toBe("upstream connection timeout")
            expect(result.stacktrace).toBeUndefined()
        })

        it("returns default message for an empty body string", () => {
            const result = parseHttpErrorBody("")
            expect(result.message).toBe("Request failed")
        })

        it("returns default message when JSON has no recognised error shape", () => {
            const result = parseHttpErrorBody(JSON.stringify({code: 500}))
            expect(result.message).toBe("Request failed")
        })

        it("status branch takes priority over detail branch", () => {
            const body = JSON.stringify({
                status: {message: "from status"},
                detail: {message: "from detail"},
            })
            expect(parseHttpErrorBody(body).message).toBe("from status")
        })
    })
})

// ─── normalizeStacktrace ──────────────────────────────────────────────────────

describe("normalizeStacktrace", () => {
    it("passes a plain string through unchanged", () => {
        expect(normalizeStacktrace("line one\nline two")).toBe("line one\nline two")
    })

    it("joins array frames with '\\n'", () => {
        // Frames without trailing newlines — join inserts exactly one \n between each.
        const frames = [
            "Traceback (most recent call last):",
            '  File "app.py", line 10, in invoke',
            "ValueError: bad input",
        ]
        expect(normalizeStacktrace(frames)).toBe(
            'Traceback (most recent call last):\n  File "app.py", line 10, in invoke\nValueError: bad input',
        )
    })

    it("returns undefined for undefined", () => {
        expect(normalizeStacktrace(undefined)).toBeUndefined()
    })

    it("returns undefined for an empty array (no frames to show)", () => {
        expect(normalizeStacktrace([])).toBeUndefined()
    })

    it("returns undefined for an empty string", () => {
        expect(normalizeStacktrace("")).toBeUndefined()
    })
})
