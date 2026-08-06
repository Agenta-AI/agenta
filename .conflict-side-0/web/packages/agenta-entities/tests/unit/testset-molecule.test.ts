/**
 * Unit tests for testsetMolecule and its filter / draft atoms.
 *
 * These tests target the parts of the testset molecule that can be exercised
 * without a running backend or a TanStack QueryClient:
 *
 *   • Filter atoms  — plain Jotai atoms (no query dependency)
 *   • Draft operations — update / discard reducers write to draftAtomFamily
 *   • isDirty atom  — reads draft, not server data, so query is not needed
 *   • isNew detection — pure function + createStore
 *   • Null-safe selectors — queryOptional / dataOptional with null IDs
 *   • Molecule shape — exported properties exist
 *
 * The TanStack Query-backed atoms (testsetQueryAtomFamily) are NOT exercised
 * here — those require a live QueryClient and belong in integration tests.
 */

import {describe, it, expect} from "vitest"
import {createStore} from "jotai"

import {testsetMolecule} from "../../src/testset/state/testsetMolecule"
import {isNewTestsetId} from "../../src/testset/core"

// ── helpers ───────────────────────────────────────────────────────────────────

function freshStore() {
    return createStore()
}

// ── Molecule shape ────────────────────────────────────────────────────────────

describe("testsetMolecule shape", () => {
    it("exposes 'testset' as the molecule name", () => {
        expect(testsetMolecule.name).toBe("testset")
    })

    it("exposes atoms namespace", () => {
        expect(testsetMolecule.atoms).toBeDefined()
        expect(typeof testsetMolecule.atoms.data).toBe("function")
        expect(typeof testsetMolecule.atoms.isDirty).toBe("function")
        expect(typeof testsetMolecule.atoms.draft).toBe("function")
        expect(typeof testsetMolecule.atoms.serverData).toBe("function")
    })

    it("exposes actions namespace", () => {
        expect(testsetMolecule.actions).toBeDefined()
        expect(testsetMolecule.actions.update).toBeDefined()
        expect(testsetMolecule.actions.discard).toBeDefined()
        expect(testsetMolecule.actions.save).toBeDefined()
        expect(testsetMolecule.actions.delete).toBeDefined()
    })

    it("exposes get namespace with imperative read functions", () => {
        expect(typeof testsetMolecule.get.data).toBe("function")
        expect(typeof testsetMolecule.get.isDirty).toBe("function")
    })

    it("exposes set namespace with imperative write functions", () => {
        expect(typeof testsetMolecule.set.update).toBe("function")
        expect(typeof testsetMolecule.set.discard).toBe("function")
        expect(typeof testsetMolecule.set.create).toBe("function")
    })

    it("exposes filters namespace", () => {
        expect(testsetMolecule.filters).toBeDefined()
        expect(testsetMolecule.filters.searchTerm).toBeDefined()
        expect(testsetMolecule.filters.exportFormat).toBeDefined()
        expect(testsetMolecule.filters.dateCreated).toBeDefined()
        expect(testsetMolecule.filters.dateModified).toBeDefined()
    })

    it("exposes paginated namespace", () => {
        expect(testsetMolecule.paginated).toBeDefined()
        expect(testsetMolecule.paginated.store).toBeDefined()
        expect(testsetMolecule.paginated.refreshAtom).toBeDefined()
    })

    it("exposes latestRevision namespace", () => {
        expect(testsetMolecule.latestRevision).toBeDefined()
        expect(typeof testsetMolecule.latestRevision.selectors.data).toBe("function")
        expect(typeof testsetMolecule.latestRevision.selectors.stateful).toBe("function")
        expect(typeof testsetMolecule.latestRevision.get).toBe("function")
    })

    it("exposes invalidate namespace", () => {
        expect(typeof testsetMolecule.invalidate.list).toBe("function")
        expect(typeof testsetMolecule.invalidate.detail).toBe("function")
    })

    it("exposes lifecycle namespace", () => {
        expect(typeof testsetMolecule.lifecycle.archive).toBe("function")
        expect(typeof testsetMolecule.lifecycle.unarchive).toBe("function")
    })
})

// ── isNewTestsetId ────────────────────────────────────────────────────────────

describe("isNewTestsetId", () => {
    it("returns true for new- prefixed IDs", () => {
        expect(isNewTestsetId("new-abc")).toBe(true)
    })

    it("returns true for local- prefixed IDs", () => {
        expect(isNewTestsetId("local-123")).toBe(true)
    })

    it("returns false for regular UUID-like IDs", () => {
        expect(isNewTestsetId("550e8400-e29b-41d4-a716-446655440000")).toBe(false)
    })

    it("returns false for null", () => {
        expect(isNewTestsetId(null)).toBe(false)
    })

    it("returns false for undefined", () => {
        expect(isNewTestsetId(undefined)).toBe(false)
    })
})

// ── Filter atoms ──────────────────────────────────────────────────────────────

describe("testset filter atoms", () => {
    it("searchTerm atom starts as empty string", () => {
        const store = freshStore()
        expect(store.get(testsetMolecule.filters.searchTerm)).toBe("")
    })

    it("searchTerm can be written and read back", () => {
        const store = freshStore()
        store.set(testsetMolecule.filters.searchTerm, "my-search")
        expect(store.get(testsetMolecule.filters.searchTerm)).toBe("my-search")
    })

    it("dateCreated atom starts as null", () => {
        const store = freshStore()
        expect(store.get(testsetMolecule.filters.dateCreated)).toBeNull()
    })

    it("dateCreated can be written and read back", () => {
        const store = freshStore()
        const range = {start: "2024-01-01", end: "2024-12-31"}
        store.set(testsetMolecule.filters.dateCreated, range)
        expect(store.get(testsetMolecule.filters.dateCreated)).toEqual(range)
    })

    it("dateModified atom starts as null", () => {
        const store = freshStore()
        expect(store.get(testsetMolecule.filters.dateModified)).toBeNull()
    })

    it("different store instances are isolated", () => {
        const storeA = freshStore()
        const storeB = freshStore()
        storeA.set(testsetMolecule.filters.searchTerm, "only-in-A")
        expect(storeB.get(testsetMolecule.filters.searchTerm)).toBe("")
    })
})

// ── Draft operations ──────────────────────────────────────────────────────────

describe("testset draft operations", () => {
    it("isDirty is false before any update", () => {
        const store = freshStore()
        expect(store.get(testsetMolecule.atoms.isDirty("ts-1"))).toBe(false)
    })

    it("isDirty is true after calling actions.update", () => {
        const store = freshStore()
        store.set(testsetMolecule.actions.update, "ts-1", {name: "New Name"})
        expect(store.get(testsetMolecule.atoms.isDirty("ts-1"))).toBe(true)
    })

    it("draft atom reflects the staged changes", () => {
        const store = freshStore()
        store.set(testsetMolecule.actions.update, "ts-1", {name: "Staged"})
        const draft = store.get(testsetMolecule.atoms.draft("ts-1"))
        expect(draft).toMatchObject({name: "Staged"})
    })

    it("actions.update accumulates across multiple calls", () => {
        const store = freshStore()
        store.set(testsetMolecule.actions.update, "ts-1", {name: "First"})
        store.set(testsetMolecule.actions.update, "ts-1", {description: "Second"})
        const draft = store.get(testsetMolecule.atoms.draft("ts-1"))
        expect(draft).toMatchObject({name: "First", description: "Second"})
    })

    it("actions.discard clears the draft and isDirty becomes false", () => {
        const store = freshStore()
        store.set(testsetMolecule.actions.update, "ts-1", {name: "Pending"})
        store.set(testsetMolecule.actions.discard, "ts-1")
        expect(store.get(testsetMolecule.atoms.isDirty("ts-1"))).toBe(false)
        expect(store.get(testsetMolecule.atoms.draft("ts-1"))).toBeNull()
    })

    it("changes to one ID do not affect another", () => {
        const store = freshStore()
        store.set(testsetMolecule.actions.update, "ts-A", {name: "A"})
        expect(store.get(testsetMolecule.atoms.isDirty("ts-B"))).toBe(false)
    })
})

// ── Local entity creation ─────────────────────────────────────────────────────

describe("testset local entity creation", () => {
    it("set.create returns a new- prefixed ID", () => {
        const store = freshStore()
        const id = testsetMolecule.set.create({name: "Draft Testset"}, {store})
        expect(id.startsWith("new-")).toBe(true)
    })

    it("multiple creates return unique IDs", () => {
        const store = freshStore()
        const id1 = testsetMolecule.set.create({name: "A"}, {store})
        const id2 = testsetMolecule.set.create({name: "B"}, {store})
        expect(id1).not.toBe(id2)
    })

    it("created ID is recognized as new by isNewTestsetId", () => {
        const store = freshStore()
        const id = testsetMolecule.set.create({name: "New"}, {store})
        expect(isNewTestsetId(id)).toBe(true)
    })
})

// ── Null-safe selectors ───────────────────────────────────────────────────────

describe("testset null-safe selectors", () => {
    it("queryOptional(null) returns an atom with isPending=false and data=null", () => {
        const store = freshStore()
        const result = store.get(testsetMolecule.queryOptional(null))
        expect(result.isPending).toBe(false)
        expect(result.data).toBeNull()
    })

    it("queryOptional(undefined) returns an atom with isPending=false and data=null", () => {
        const store = freshStore()
        const result = store.get(testsetMolecule.queryOptional(undefined))
        expect(result.isPending).toBe(false)
        expect(result.data).toBeNull()
    })

    it("dataOptional(null) returns null", () => {
        const store = freshStore()
        expect(store.get(testsetMolecule.dataOptional(null))).toBeNull()
    })

    it("dataOptional(undefined) returns null", () => {
        const store = freshStore()
        expect(store.get(testsetMolecule.dataOptional(undefined))).toBeNull()
    })

    it("queryOptional with a valid ID returns an atom (delegates to query family)", () => {
        // The atom exists — we can't assert data without a QueryClient, but we can
        // verify that a truthy atom is returned (not the null sentinel).
        const atom = testsetMolecule.queryOptional("real-id")
        expect(atom).toBeDefined()
        expect(typeof atom).toBe("object")
    })
})
