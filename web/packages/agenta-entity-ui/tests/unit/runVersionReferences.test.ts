import {describe, expect, it} from "vitest"

import {
    buildRunVersionReferences,
    extractBoundWorkflowId,
    hasBoundWorkflow,
    isRunVersionBound,
} from "../../src/gatewayTrigger/drawers/shared/RunVersionField"

describe("hasBoundWorkflow", () => {
    it("recognizes a leaf revision or variant binding", () => {
        expect(hasBoundWorkflow({application_revision: {id: "rev-1"}})).toBe(true)
        expect(hasBoundWorkflow({application_variant: {id: "var-1"}})).toBe(true)
    })

    // The backend reads an artifact-only family as "resolve latest at trigger time".
    it("recognizes an artifact-level binding with no variant or revision", () => {
        expect(hasBoundWorkflow({application: {id: "app-1"}})).toBe(true)
        expect(hasBoundWorkflow({workflow: {id: "wf-1"}})).toBe(true)
        expect(hasBoundWorkflow({evaluator_revision: {id: "ev-1"}})).toBe(true)
    })

    it("recognizes a slug-keyed binding (no ids anywhere)", () => {
        expect(hasBoundWorkflow({application: {slug: "technical-writer"}})).toBe(true)
        expect(hasBoundWorkflow({application_variant: {slug: "default", version: "3"}})).toBe(true)
    })

    it("reports no binding for empty, missing, or environment-only families", () => {
        expect(hasBoundWorkflow(null)).toBe(false)
        expect(hasBoundWorkflow(undefined)).toBe(false)
        expect(hasBoundWorkflow({})).toBe(false)
        expect(hasBoundWorkflow({environment: {slug: "production"}})).toBe(false)
        // Present but carrying neither id nor slug.
        expect(hasBoundWorkflow({application: {version: "3"}})).toBe(false)
    })

    // A deployed family carries `application.slug`; counting it as a pin would let Pinned
    // save while `buildRunVersionReferences` silently resent the environment ref.
    it("does not count a deployed family as a pin", () => {
        expect(
            hasBoundWorkflow({
                environment: {slug: "production"},
                application: {slug: "technical-writer"},
            }),
        ).toBe(false)
    })
})

describe("extractBoundWorkflowId", () => {
    it("prefers the most specific id", () => {
        const refs = {
            application: {id: "app-1"},
            application_variant: {id: "var-1"},
            application_revision: {id: "rev-1"},
        }
        expect(extractBoundWorkflowId(refs)).toBe("rev-1")
    })

    it("falls back to the artifact id when no variant or revision is pinned", () => {
        expect(extractBoundWorkflowId({application: {id: "app-1"}})).toBe("app-1")
    })

    // Same key table as hasBoundWorkflow, so evaluator families resolve an id too.
    it("covers every artifact family the backend resolves", () => {
        expect(extractBoundWorkflowId({evaluator_variant: {id: "ev-1"}})).toBe("ev-1")
        expect(extractBoundWorkflowId({workflow: {id: "wf-1"}})).toBe("wf-1")
    })

    it("returns null when nothing carries an id", () => {
        expect(extractBoundWorkflowId({application: {slug: "technical-writer"}})).toBeNull()
        expect(extractBoundWorkflowId(null)).toBeNull()
    })
})

describe("isRunVersionBound", () => {
    it("counts the picker's leaf or a stored pin in Pinned mode", () => {
        expect(isRunVersionBound({bindMode: "revision", workflowRevId: "rev-1"})).toBe(true)
        expect(
            isRunVersionBound({
                bindMode: "revision",
                storedReferences: {application: {slug: "technical-writer"}},
            }),
        ).toBe(true)
        expect(isRunVersionBound({bindMode: "revision"})).toBe(false)
    })

    it("rejects Pinned backed only by a stored deployed family", () => {
        expect(
            isRunVersionBound({
                bindMode: "revision",
                storedReferences: {
                    environment: {slug: "production"},
                    application: {slug: "technical-writer"},
                },
            }),
        ).toBe(false)
    })

    it("needs an environment in Deployed mode, ignoring the picker", () => {
        expect(isRunVersionBound({bindMode: "environment", environmentSlug: "production"})).toBe(
            true,
        )
        expect(isRunVersionBound({bindMode: "environment", workflowRevId: "rev-1"})).toBe(false)
    })
})

describe("buildRunVersionReferences", () => {
    // An artifact-level binding must not be narrowed to a pinned revision on an unrelated edit.
    it("resends stored references when there is no fresh pick", () => {
        const stored = {application: {slug: "technical-writer"}}
        expect(
            buildRunVersionReferences({
                bindMode: "revision",
                workflowSelection: null,
                workflowRevId: null,
                fallbackReferences: stored,
            }),
        ).toEqual(stored)
    })

    it("routes a fresh pick to variant or revision by the picker's leaf", () => {
        const metadata = {
            workflowId: "app-1",
            workflowName: "writer",
            variantId: "var-1",
            variantName: "default",
            revision: 3,
        }
        expect(
            buildRunVersionReferences({
                bindMode: "revision",
                workflowSelection: {
                    type: "workflowRevision",
                    id: "rev-1",
                    label: "",
                    path: [],
                    metadata,
                },
                workflowRevId: "rev-1",
            }),
        ).toEqual({application: {id: "app-1"}, application_revision: {id: "rev-1"}})

        expect(
            buildRunVersionReferences({
                bindMode: "revision",
                workflowSelection: {
                    type: "workflowRevision",
                    id: "var-1",
                    label: "",
                    path: [],
                    metadata,
                },
                workflowRevId: "var-1",
            }),
        ).toEqual({application: {id: "app-1"}, application_variant: {id: "var-1"}})
    })
})
