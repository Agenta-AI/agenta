/**
 * `updateWorkflowDraftAtom`'s change notification.
 *
 * This is what drives the agent playground's auto-commit (#6126) — the behaviour hangs off the
 * WRITE rather than off a mounted view, so anything that edits a config triggers a save whether
 * or not the config panel happens to be on screen.
 *
 * The case that has to hold is the negative one: restoring the localStorage draft snapshot goes
 * through this same atom, and if that counted as an edit, merely reopening a tab would commit a
 * revision the user never asked for.
 */
import {createStore} from "jotai"
import {describe, it, expect, beforeEach, afterEach} from "vitest"

import {
    clearWorkflowDraftCallbacks,
    registerWorkflowDraftCallbacks,
    updateWorkflowDraftAtom,
} from "../../src/workflow/state/store"

// A local-draft id has no server baseline to be compared against, which is the shortest path
// through the atom's "don't invent a diff before the server data lands" guards.
const ID = "local-draft-abc"

let store: ReturnType<typeof createStore>
let changed: string[]

beforeEach(() => {
    store = createStore()
    changed = []
    registerWorkflowDraftCallbacks({onDraftChange: (id) => changed.push(id)})
})

afterEach(() => {
    clearWorkflowDraftCallbacks()
})

describe("updateWorkflowDraftAtom → onDraftChange", () => {
    it("reports an edit", () => {
        store.set(updateWorkflowDraftAtom, ID, {data: {parameters: {agent: {a: 1}}}} as never)
        expect(changed).toEqual([ID])
    })

    it("stays silent for a hydrating restore", () => {
        store.set(updateWorkflowDraftAtom, ID, {data: {parameters: {agent: {a: 1}}}} as never, {
            hydrating: true,
        })
        expect(changed).toEqual([])
    })

    it("reports each subsequent edit, so a debounce upstream can coalesce them", () => {
        store.set(updateWorkflowDraftAtom, ID, {data: {parameters: {agent: {a: 1}}}} as never)
        store.set(updateWorkflowDraftAtom, ID, {data: {parameters: {agent: {a: 2}}}} as never)
        expect(changed).toEqual([ID, ID])
    })
})
