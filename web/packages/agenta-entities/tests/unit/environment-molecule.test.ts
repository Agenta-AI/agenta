/**
 * Unit tests for environmentMolecule.
 *
 * The environment molecule follows the same createMolecule + extendMolecule pattern
 * as the testset molecule. All write operations make API calls (archive, commit,
 * deploy) so those are out of scope here. We test the pure Jotai layer:
 *
 *   • isNewEntity          — always false (no local creation flow)
 *   • Draft operations     — update/discard reducers change draft and isDirty
 *   • Null-safe selectors  — queryOptional / dataOptional with null/undefined
 */

import {createStore} from "jotai"
import {describe, it, expect} from "vitest"

import {environmentMolecule} from "../../src/environment/state/environmentMolecule"

// ── helpers ───────────────────────────────────────────────────────────────────

function freshStore() {
    return createStore()
}

// ── isNewEntity ───────────────────────────────────────────────────────────────

describe("environmentMolecule isNewEntity", () => {
    it("isNew is false for any ID (environments have no local creation flow)", () => {
        const store = freshStore()
        expect(store.get(environmentMolecule.atoms.isNew("env-1"))).toBe(false)
        expect(store.get(environmentMolecule.atoms.isNew("new-env"))).toBe(false)
        expect(store.get(environmentMolecule.atoms.isNew("local-env"))).toBe(false)
    })
})

// ── Draft operations ──────────────────────────────────────────────────────────

describe("environmentMolecule draft operations", () => {
    it("isDirty is false before any update", () => {
        const store = freshStore()
        expect(store.get(environmentMolecule.atoms.isDirty("env-1"))).toBe(false)
    })

    it("isDirty is true after calling actions.update", () => {
        const store = freshStore()
        store.set(environmentMolecule.actions.update, "env-1", {name: "Production"})
        expect(store.get(environmentMolecule.atoms.isDirty("env-1"))).toBe(true)
    })

    it("draft atom reflects staged changes", () => {
        const store = freshStore()
        store.set(environmentMolecule.actions.update, "env-1", {name: "Staging"})
        expect(store.get(environmentMolecule.atoms.draft("env-1"))).toMatchObject({
            name: "Staging",
        })
    })

    it("actions.update accumulates across multiple calls", () => {
        const store = freshStore()
        store.set(environmentMolecule.actions.update, "env-1", {name: "First"})
        store.set(environmentMolecule.actions.update, "env-1", {description: "Second"})
        const draft = store.get(environmentMolecule.atoms.draft("env-1"))
        expect(draft).toMatchObject({name: "First", description: "Second"})
    })

    it("actions.discard clears draft and isDirty returns false", () => {
        const store = freshStore()
        store.set(environmentMolecule.actions.update, "env-1", {name: "Pending"})
        store.set(environmentMolecule.actions.discard, "env-1")
        expect(store.get(environmentMolecule.atoms.isDirty("env-1"))).toBe(false)
        expect(store.get(environmentMolecule.atoms.draft("env-1"))).toBeNull()
    })

    it("draft for one env ID does not affect another", () => {
        const store = freshStore()
        store.set(environmentMolecule.actions.update, "env-A", {name: "A"})
        expect(store.get(environmentMolecule.atoms.isDirty("env-B"))).toBe(false)
    })

    it("imperative set.update changes draft", () => {
        const store = freshStore()
        environmentMolecule.set.update("env-1", {name: "Imperative"}, {store})
        expect(store.get(environmentMolecule.atoms.isDirty("env-1"))).toBe(true)
    })

    it("imperative set.discard reverts draft", () => {
        const store = freshStore()
        environmentMolecule.set.update("env-1", {name: "Changed"}, {store})
        environmentMolecule.set.discard("env-1", {store})
        expect(store.get(environmentMolecule.atoms.isDirty("env-1"))).toBe(false)
    })
})

// ── Null-safe selectors ───────────────────────────────────────────────────────

describe("environmentMolecule null-safe selectors", () => {
    it("queryOptional(null) returns atom with isPending=false, data=null", () => {
        const store = freshStore()
        const result = store.get(environmentMolecule.queryOptional(null))
        expect(result.isPending).toBe(false)
        expect(result.data).toBeNull()
    })

    it("queryOptional(undefined) returns atom with isPending=false, data=null", () => {
        const store = freshStore()
        const result = store.get(environmentMolecule.queryOptional(undefined))
        expect(result.isPending).toBe(false)
        expect(result.data).toBeNull()
    })

    it("dataOptional(null) returns null", () => {
        const store = freshStore()
        expect(store.get(environmentMolecule.dataOptional(null))).toBeNull()
    })

    it("dataOptional(undefined) returns null", () => {
        const store = freshStore()
        expect(store.get(environmentMolecule.dataOptional(undefined))).toBeNull()
    })

    it("queryOptional with a real ID returns a truthy atom (delegates to query family)", () => {
        const atom = environmentMolecule.queryOptional("real-env-id")
        expect(atom).toBeDefined()
        expect(typeof atom).toBe("object")
    })
})

// ── Lifecycle ─────────────────────────────────────────────────────────────────

describe("environmentMolecule lifecycle", () => {
    it("lifecycle.isActive is false before any access", () => {
        expect(environmentMolecule.lifecycle.isActive("env-lifecycle-1")).toBe(false)
    })

    it("lifecycle.isActive is true after atoms.serverData is first accessed", () => {
        const store = freshStore()
        store.get(environmentMolecule.atoms.serverData("env-lifecycle-2"))
        expect(environmentMolecule.lifecycle.isActive("env-lifecycle-2")).toBe(true)
    })

    it("lifecycle.isActive is false after cleanup.remove", () => {
        const store = freshStore()
        store.get(environmentMolecule.atoms.serverData("env-lifecycle-3"))
        environmentMolecule.cleanup.remove("env-lifecycle-3")
        expect(environmentMolecule.lifecycle.isActive("env-lifecycle-3")).toBe(false)
    })
})
