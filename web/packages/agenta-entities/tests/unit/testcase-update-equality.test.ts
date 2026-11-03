/**
 * updateTestcaseAtom decides whether an edit still differs from the server row.
 * If it wrongly says "equal", the draft is cleared and the edit is never saved.
 * These tests use the real store atoms and seed the server row in the query cache.
 */

import {projectIdAtom} from "@agenta/shared/state"
import {createStore} from "jotai"
import {queryClientAtom} from "jotai-tanstack-query"
import {describe, expect, it} from "vitest"

import type {Testcase} from "../../src/testcase"
import {testcaseMolecule} from "../../src/testcase/state/molecule"
import {testcaseDraftAtomFamily, updateTestcaseAtom} from "../../src/testcase/state/store"

const PROJECT_ID = "project-1"

function setup(serverData: Record<string, unknown>) {
    const id = "tc-1"
    const store = createStore()
    store.set(projectIdAtom, PROJECT_ID)
    const server = {id, data: serverData} as Testcase
    store.get(queryClientAtom).setQueryData(["testcase", PROJECT_ID, id], server)
    // Subscribe so the query atom picks up the seeded cache entry.
    const unsubscribe = store.sub(testcaseMolecule.atoms.data(id), () => {})
    return {store, id, unsubscribe}
}

function editData(store: ReturnType<typeof createStore>, id: string, data: Record<string, unknown>) {
    store.set(updateTestcaseAtom, id, {data})
    return {
        draft: store.get(testcaseDraftAtomFamily(id)),
        dirty: store.get(testcaseMolecule.atoms.isDirty(id)),
    }
}

describe("updateTestcaseAtom equality with the server row", () => {
    it("keeps an edit that changes a value", () => {
        const {store, id, unsubscribe} = setup({a: "x"})
        const {draft, dirty} = editData(store, id, {a: "y"})
        expect(draft?.data).toEqual({a: "y"})
        expect(dirty).toBe(true)
        unsubscribe()
    })

    it("clears the draft when the value returns to the server value", () => {
        const {store, id, unsubscribe} = setup({a: "x"})
        editData(store, id, {a: "y"})
        const {draft, dirty} = editData(store, id, {a: "x"})
        expect(draft).toBeNull()
        expect(dirty).toBe(false)
        unsubscribe()
    })

    it("keeps an edit that only removes a field whose value is null", () => {
        const {store, id, unsubscribe} = setup({a: "x", b: null})
        const {draft, dirty} = editData(store, id, {b: undefined})
        expect(draft).not.toBeNull()
        expect(draft?.data).toEqual({a: "x"})
        expect(dirty).toBe(true)
        unsubscribe()
    })

    it("keeps an edit that only removes a field whose value is an empty string", () => {
        const {store, id, unsubscribe} = setup({a: "x", b: ""})
        const {draft, dirty} = editData(store, id, {b: undefined})
        expect(draft).not.toBeNull()
        expect(dirty).toBe(true)
        unsubscribe()
    })

    it("keeps an edit that adds a field with a real value", () => {
        const {store, id, unsubscribe} = setup({a: "x"})
        const {draft, dirty} = editData(store, id, {b: "new"})
        expect(draft?.data).toEqual({a: "x", b: "new"})
        expect(dirty).toBe(true)
        unsubscribe()
    })

    it("does not keep a draft when an edit adds a field whose value is empty (type then clear)", () => {
        const {store, id, unsubscribe} = setup({a: "x"})
        editData(store, id, {b: "typed"})
        const {draft, dirty} = editData(store, id, {b: ""})
        expect(draft).toBeNull()
        expect(dirty).toBe(false)
        unsubscribe()
    })
})
