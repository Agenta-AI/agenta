/**
 * The commit dialog says which version the save creates. The server numbers a new revision after
 * the variant's newest revision, so committing from an older revision must not read
 * "current + 1".
 */
import {createStore} from "jotai"
import {atom} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

const revisions = vi.hoisted(() => ({
    current: {
        id: "rev-9",
        version: 9,
        workflow_variant_id: "variant-1",
        data: {parameters: {prompt: {messages: []}}},
    },
    refs: [] as {id: string; version: number | null; created_at: string | null}[],
    newestWithArchived: null as number | null,
}))

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const original = await importOriginal<typeof import("@agenta/entities/workflow")>()
    return {
        ...original,
        workflowMolecule: {
            ...original.workflowMolecule,
            selectors: {
                ...original.workflowMolecule.selectors,
                data: () => atom(revisions.current),
                serverData: () => atom(revisions.current),
            },
        },
        workflowRevisionRefsByVariantAtomFamily: () => atom(revisions.refs),
        workflowVariantNewestVersionAtomFamily: () => atom(revisions.newestWithArchived),
    }
})

import {variantModalAdapter} from "../../src/adapters/variantAdapters"

const targetVersionOf = () => {
    const store = createStore()
    const context = store.get(variantModalAdapter.commitContextAtom!("rev-9"))
    return context?.versionInfo?.targetVersion
}

describe("variant commit dialog: next version", () => {
    beforeEach(() => {
        revisions.newestWithArchived = null
    })

    it("shows the variant's newest version plus one when the commit starts from an older revision", () => {
        revisions.refs = [
            {id: "rev-10", version: 10, created_at: null},
            {id: "rev-9", version: 9, created_at: null},
        ]
        expect(targetVersionOf()).toBe(11)
    })

    it("shows the current version plus one when the revision is the newest", () => {
        revisions.refs = [{id: "rev-9", version: 9, created_at: null}]
        expect(targetVersionOf()).toBe(10)
    })

    it("falls back to the current version plus one while the variant's list has not loaded", () => {
        revisions.refs = []
        expect(targetVersionOf()).toBe(10)
    })

    it("counts an archived revision that is the variant's newest", () => {
        // The list hides archived revisions, but the server still numbers after them.
        revisions.refs = [{id: "rev-9", version: 9, created_at: null}]
        revisions.newestWithArchived = 10
        expect(targetVersionOf()).toBe(11)
    })
})
