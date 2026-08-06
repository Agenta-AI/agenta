/**
 * Tests for the OpenAPI-derived Zod boundary validation.
 *
 * Demonstrates the pattern used in `Workflows.query`: response goes through
 * `validateBoundary(raw, schema, label)` which calls `schema.safeParse` and
 * either returns the parsed value or logs a one-line warning and falls
 * through with the raw value unchanged.
 *
 * The point is to verify three properties:
 *   1. Valid responses pass through cleanly (no warning, parsed value returned).
 *   2. Drifted responses warn and fall through (no thrown error, raw value preserved).
 *   3. Backend `extra="allow"` semantics — unknown fields don't trigger drift
 *      because every generated schema ends with `.passthrough()`.
 */

import {describe, it, expect, vi, afterEach} from "vitest"
import {z} from "zod"

import {validateBoundary, schemas} from "@src/.generated/index.js"

afterEach(() => {
    vi.restoreAllMocks()
})

describe("validateBoundary", () => {
    const schema = z
        .object({
            count: z.number(),
            workflows: z.array(z.object({id: z.string()}).passthrough()),
        })
        .passthrough()

    it("returns parsed value on success — no warning logged", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

        const result = validateBoundary(
            {count: 2, workflows: [{id: "a"}, {id: "b"}]},
            schema,
            "Test.method",
        )

        expect(result).toEqual({count: 2, workflows: [{id: "a"}, {id: "b"}]})
        expect(warn).not.toHaveBeenCalled()
    })

    it("warns and passes through when shape drifts (wrong type)", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const malformed = {count: "two", workflows: []}

        const result = validateBoundary(malformed, schema, "Test.method")

        expect(result).toEqual(malformed)
        expect(warn).toHaveBeenCalledOnce()
        const message = warn.mock.calls[0][0] as string
        expect(message).toContain("[@agenta/sdk] Test.method response shape drift")
        expect(message).toContain("count:")
    })

    it("does NOT warn on unknown fields (passthrough mirrors extra='allow')", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

        const result = validateBoundary(
            {
                count: 1,
                workflows: [{id: "a", new_backend_field: "added later"}],
                top_level_extra: {arbitrary: "data"},
            },
            schema,
            "Test.method",
        )

        // The unknown field is preserved, no warning fires.
        expect(result).toMatchObject({
            count: 1,
            top_level_extra: {arbitrary: "data"},
        })
        expect((result.workflows[0] as Record<string, unknown>).new_backend_field).toBe(
            "added later",
        )
        expect(warn).not.toHaveBeenCalled()
    })

    it("truncates issue lists to 5 + a `(+N more)` suffix on heavy drift", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
        const heavy = z.object({
            a: z.string(),
            b: z.string(),
            c: z.string(),
            d: z.string(),
            e: z.string(),
            f: z.string(),
            g: z.string(),
        })

        validateBoundary({a: 1, b: 2, c: 3, d: 4, e: 5, f: 6, g: 7}, heavy, "Heavy")

        const message = warn.mock.calls[0][0] as string
        expect(message).toMatch(/\(\+\d+ more\)/)
    })
})

describe("openapi-derived schemas registry", () => {
    it("exposes a non-empty schemas object", () => {
        expect(typeof schemas).toBe("object")
        expect(Object.keys(schemas).length).toBeGreaterThan(100)
    })

    it("includes the schemas a real consumer would use", () => {
        // Spot-check: each of these is referenced by `Workflows.query` (or will
        // be when more boundary checks are wired). If the generator drops them,
        // we want to know.
        expect(schemas.Workflow).toBeDefined()
        expect(schemas.WorkflowsResponse).toBeDefined()
        expect(schemas.WorkflowFlags).toBeDefined()
    })

    it("WorkflowFlags carries the full backend flag set (more than what TS hand-wrote)", () => {
        // Documents the audit finding: the OpenAPI spec exposes a wider flag
        // set than the original hand-written types.ts had. If this test fails
        // because the field set changed, that's interesting drift to triage.
        const parsed = schemas.WorkflowFlags.safeParse({
            is_application: true,
            is_evaluator: false,
            is_chat: true,
            is_custom: false,
        })
        expect(parsed.success).toBe(true)
    })

    it("schemas with passthrough accept arbitrary backend additions", () => {
        const parsed = schemas.Workflow.safeParse({
            id: "w-1",
            slug: "my-workflow",
            name: "My Workflow",
            // Real-world: the backend might add `last_invoked_at` next quarter.
            // We don't want that to break consumers.
            last_invoked_at: "2026-04-29T00:00:00Z",
        })
        expect(parsed.success).toBe(true)
    })
})
