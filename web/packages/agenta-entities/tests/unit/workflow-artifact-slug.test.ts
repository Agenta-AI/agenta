/**
 * `workflowMolecule.selectors.artifactSlug` reads the slug of the workflow ARTIFACT.
 *
 * A revision's own `slug` is an opaque 12-hex id. The trigger drawers once sent it as
 * `application.slug` next to the artifact id, and the API rejected the pair as
 * inconsistent (#7517). The selector must never fall back to the revision's slug.
 */
import {atom, createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

const fixture = vi.hoisted(() => ({
    entities: {} as Record<string, {workflow_id?: string; slug?: string} | null>,
    artifacts: {} as Record<string, {slug?: string} | undefined>,
}))

vi.mock("../../src/workflow/state/store", async (original) => {
    const actual = await original<typeof import("../../src/workflow/state/store")>()
    return {
        ...actual,
        workflowBaseEntityAtomFamily: (id: string) => atom(() => fixture.entities[id] ?? null),
        workflowArtifactQueryAtomFamily: (id: string) =>
            atom(() => ({data: fixture.artifacts[id]})),
    }
})

import {workflowMolecule} from "../../src/workflow"

describe("workflowMolecule.selectors.artifactSlug", () => {
    it("returns the artifact slug for a revision id, not the revision's slug", () => {
        fixture.entities["rev-1"] = {workflow_id: "wf-1", slug: "461bf8c42aa4"}
        fixture.artifacts["wf-1"] = {slug: "agent-mv0xreqcdp"}

        const store = createStore()
        expect(store.get(workflowMolecule.selectors.artifactSlug("rev-1"))).toBe("agent-mv0xreqcdp")
    })

    it("returns null until the artifact loads, without falling back to the revision", () => {
        fixture.entities["rev-2"] = {workflow_id: "wf-2", slug: "0123456789ab"}
        fixture.artifacts["wf-2"] = undefined

        const store = createStore()
        expect(store.get(workflowMolecule.selectors.artifactSlug("rev-2"))).toBeNull()
    })

    it("returns null for an empty id", () => {
        const store = createStore()
        expect(store.get(workflowMolecule.selectors.artifactSlug(""))).toBeNull()
    })
})
