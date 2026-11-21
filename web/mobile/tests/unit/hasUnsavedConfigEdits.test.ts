import {createStore} from "jotai"
import {describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const clean = atom(false)
    return {workflowMolecule: {selectors: {isDirty: () => clean}}}
})
vi.mock("@agenta/playground/state", async () => {
    const {atom} = await import("jotai")
    const idle = atom<boolean | string | null>(null)
    return {
        agentAutoCommitScheduledAtomFamily: () => idle,
        agentAutoCommitStatusAtomFamily: () => idle,
    }
})

import {hasUnsavedConfigEdits} from "@/features/chat/hasUnsavedConfigEdits"
import {viewFormDirtyAtom} from "@/features/chat/viewFormDirty"

describe("hasUnsavedConfigEdits", () => {
    it("counts an open view form with edits, so a commit of the agent itself is held too", () => {
        const store = createStore()
        expect(hasUnsavedConfigEdits(store, "revision-4")).toBe(false)
        store.set(viewFormDirtyAtom, true)
        expect(hasUnsavedConfigEdits(store, "revision-4")).toBe(true)
    })
})
