import {agentBindingLookup} from "@agenta/automation-ui"
import {describe, expect, it} from "vitest"

describe("agentBindingLookup", () => {
    it("needs no lookup when the artifact is named, in either family", () => {
        expect(
            agentBindingLookup({application: {id: "app"}, application_variant: {id: "var"}}),
        ).toBeNull()
        expect(
            agentBindingLookup({workflow: {id: "wf"}, workflow_revision: {id: "rev"}}),
        ).toBeNull()
    })

    it("names the variant to look up when only a variant is bound", () => {
        expect(agentBindingLookup({application_variant: {id: "var"}})).toEqual({
            kind: "variant",
            id: "var",
        })
        expect(agentBindingLookup({workflow_variant: {id: "var"}})).toEqual({
            kind: "variant",
            id: "var",
        })
    })

    it("names the revision to look up when only a revision is bound", () => {
        expect(agentBindingLookup({application_revision: {id: "rev"}})).toEqual({
            kind: "revision",
            id: "rev",
        })
    })

    it("prefers the variant over the revision, like the bound id does", () => {
        expect(
            agentBindingLookup({
                application_variant: {id: "var"},
                application_revision: {id: "rev"},
            }),
        ).toEqual({kind: "variant", id: "var"})
    })

    it("has nothing to look up for an unbound or slug-only binding", () => {
        expect(agentBindingLookup(undefined)).toBeNull()
        expect(agentBindingLookup({})).toBeNull()
        expect(agentBindingLookup({application: {slug: "writer"} as {id?: string}})).toBeNull()
    })
})
