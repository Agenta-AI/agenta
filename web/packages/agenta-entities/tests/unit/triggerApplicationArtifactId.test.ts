import {describe, expect, it} from "vitest"

import {triggerApplicationArtifactId} from "../../src/gatewayTrigger/core/types"

describe("triggerApplicationArtifactId", () => {
    it("returns a proven application artifact reference", () => {
        expect(
            triggerApplicationArtifactId({
                application: {id: "application-1"},
                application_variant: {id: "variant-1"},
                application_revision: {id: "revision-1"},
            }),
        ).toBe("application-1")
    })

    it("does not reinterpret a variant ID as an application artifact ID", () => {
        expect(triggerApplicationArtifactId({application_variant: {id: "variant-1"}})).toBeNull()
    })

    it("does not reinterpret a revision ID as an application artifact ID", () => {
        expect(triggerApplicationArtifactId({application_revision: {id: "revision-1"}})).toBeNull()
    })
})
