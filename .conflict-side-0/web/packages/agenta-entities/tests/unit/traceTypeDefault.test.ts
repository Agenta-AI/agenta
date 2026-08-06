/**
 * Unit tests for defaultTraceTypeForWorkflow.
 *
 * The helper drives the soft-default `trace_type` filter on
 * `/apps/<entityId>/traces` (see `web/oss/src/state/newObservability/atoms/
 * controls.ts:filtersAtomFamily`). The truth table matters because getting
 * this wrong means evaluator users land on an empty page by default — the
 * regression that #4384 disabled the whole evaluator full-page flow over.
 */

import {describe, it, expect} from "vitest"

import {defaultTraceTypeForWorkflow} from "../../src/workflow/core/traceTypeDefault"

describe("defaultTraceTypeForWorkflow", () => {
    describe("sessions tab", () => {
        it("returns null for app workflow", () => {
            expect(defaultTraceTypeForWorkflow("app", "sessions")).toBeNull()
        })

        it("returns null for evaluator workflow", () => {
            expect(defaultTraceTypeForWorkflow("evaluator", "sessions")).toBeNull()
        })

        it("returns null for snippet workflow", () => {
            expect(defaultTraceTypeForWorkflow("snippet", "sessions")).toBeNull()
        })

        it("returns null when workflow kind is unknown", () => {
            expect(defaultTraceTypeForWorkflow(null, "sessions")).toBeNull()
        })
    })

    describe("traces tab", () => {
        it("defaults to annotation for evaluator workflows", () => {
            // Production evaluators score app traces and emit annotation-type
            // traces — that's the more common case for the per-evaluator
            // observability view, not playground-triggered standalone runs.
            expect(defaultTraceTypeForWorkflow("evaluator", "traces")).toBe("annotation")
        })

        it("defaults to invocation for app workflows", () => {
            expect(defaultTraceTypeForWorkflow("app", "traces")).toBe("invocation")
        })

        it("defaults to invocation for snippet workflows", () => {
            // Snippets behave like apps from an invocation perspective —
            // they invoke models the same way and don't generate annotations.
            expect(defaultTraceTypeForWorkflow("snippet", "traces")).toBe("invocation")
        })

        it("defaults to invocation when workflow kind is unknown (resolving)", () => {
            // Cold-load fallback: when `currentWorkflowContextAtom` is still
            // resolving, the kind comes through as `null`. Picking invocation
            // is the safest default since most users land on app pages.
            expect(defaultTraceTypeForWorkflow(null, "traces")).toBe("invocation")
        })
    })
})
