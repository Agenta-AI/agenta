/**
 * Unit tests for createLocalMolecule
 *
 * A local molecule manages client-only entities — things that exist purely in
 * browser memory and have never been saved to the server. It is used for
 * draft flows, wizard steps, and temporary entities in multi-step UIs.
 *
 * Because there is no server query involved, everything is synchronous and
 * the full CRUD surface can be exercised using a custom Jotai store.
 *
 * Tests use a simple "Tag" type to keep fixtures readable.
 */

import {describe, it, expect, vi} from "vitest"
import {createStore} from "jotai"

import {createLocalMolecule} from "../../src/shared/molecule/createLocalMolecule"

// ── Fixture type ──────────────────────────────────────────────────────────────

type Tag = {
    label: string
    color: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTagMolecule(overrides?: Partial<Parameters<typeof createLocalMolecule<Tag>>[0]>) {
    return createLocalMolecule<Tag>({name: "tag", ...overrides})
}

function freshStore() {
    return createStore()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createLocalMolecule", () => {
    // ── Create ────────────────────────────────────────────────────────────────

    describe("create", () => {
        it("returns a local-prefixed ID", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "urgent", color: "red"}, {store})
            expect(id.startsWith("local-")).toBe(true)
        })

        it("stores the created entity in the data atom", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "urgent", color: "red"}, {store})
            expect(store.get(mol.atoms.data(id))).toEqual({label: "urgent", color: "red"})
        })

        it("merges provided data with createDefault values", () => {
            const mol = makeTagMolecule({
                createDefault: () => ({label: "default", color: "gray"}),
            })
            const store = freshStore()
            const id = mol.set.create({color: "blue"}, {store})
            // label comes from default, color is overridden
            expect(store.get(mol.atoms.data(id))).toEqual({label: "default", color: "blue"})
        })

        it("tracks the new ID in allIds", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "x", color: "y"}, {store})
            expect(store.get(mol.atoms.allIds)).toContain(id)
        })

        it("applies the transform function after creating", () => {
            const mol = makeTagMolecule({
                transform: (tag) => ({...tag, label: tag.label.toUpperCase()}),
            })
            const store = freshStore()
            const id = mol.set.create({label: "urgent", color: "red"}, {store})
            expect(store.get(mol.atoms.data(id))?.label).toBe("URGENT")
        })

        it("calls validate and passes when data is valid", () => {
            const validate = vi.fn((tag: Tag) => tag)
            const mol = makeTagMolecule({validate})
            const store = freshStore()
            mol.set.create({label: "ok", color: "green"}, {store})
            expect(validate).toHaveBeenCalledOnce()
        })
    })

    // ── createWithId ──────────────────────────────────────────────────────────

    describe("createWithId", () => {
        it("stores the entity under the given ID", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            mol.set.createWithId("fixed-id", {label: "pinned", color: "gold"}, {store})
            expect(store.get(mol.atoms.data("fixed-id"))).toEqual({
                label: "pinned",
                color: "gold",
            })
        })
    })

    // ── Update ────────────────────────────────────────────────────────────────

    describe("update", () => {
        it("merges partial changes into existing entity", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "old", color: "blue"}, {store})
            mol.set.update(id, {label: "new"}, {store})
            expect(store.get(mol.atoms.data(id))).toEqual({label: "new", color: "blue"})
        })

        it("applies transform after updating", () => {
            const mol = makeTagMolecule({
                transform: (tag) => ({...tag, label: tag.label.toUpperCase()}),
            })
            const store = freshStore()
            const id = mol.set.create({label: "a", color: "b"}, {store})
            mol.set.update(id, {label: "urgent"}, {store})
            expect(store.get(mol.atoms.data(id))?.label).toBe("URGENT")
        })

        it("is a no-op (with a warning) when the entity does not exist", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            // Should not throw
            mol.set.update("ghost", {label: "x"}, {store})
            expect(store.get(mol.atoms.data("ghost"))).toBeNull()
        })
    })

    // ── Delete ────────────────────────────────────────────────────────────────

    describe("delete", () => {
        it("removes the entity from the data atom", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "x", color: "y"}, {store})
            mol.set.delete(id, {store})
            expect(store.get(mol.atoms.data(id))).toBeNull()
        })

        it("removes the ID from allIds", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "x", color: "y"}, {store})
            mol.set.delete(id, {store})
            expect(store.get(mol.atoms.allIds)).not.toContain(id)
        })
    })

    // ── Clear ─────────────────────────────────────────────────────────────────

    describe("clear", () => {
        it("removes all entities", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id1 = mol.set.create({label: "a", color: "red"}, {store})
            const id2 = mol.set.create({label: "b", color: "blue"}, {store})
            mol.set.clear({store})
            expect(store.get(mol.atoms.data(id1))).toBeNull()
            expect(store.get(mol.atoms.data(id2))).toBeNull()
            expect(store.get(mol.atoms.allIds)).toHaveLength(0)
        })
    })

    // ── Derived atoms ─────────────────────────────────────────────────────────

    describe("derived atoms", () => {
        it("isDirty is true when data exists", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "x", color: "y"}, {store})
            expect(store.get(mol.atoms.isDirty(id))).toBe(true)
        })

        it("isDirty is false after entity is deleted", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "x", color: "y"}, {store})
            mol.set.delete(id, {store})
            expect(store.get(mol.atoms.isDirty(id))).toBe(false)
        })

        it("isNew is always true", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "x", color: "y"}, {store})
            expect(store.get(mol.atoms.isNew(id))).toBe(true)
        })

        it("serverData is always null", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "x", color: "y"}, {store})
            expect(store.get(mol.atoms.serverData(id))).toBeNull()
        })

        it("query is always successful and non-pending", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "x", color: "y"}, {store})
            const query = store.get(mol.atoms.query(id))
            expect(query.isPending).toBe(false)
            expect(query.isError).toBe(false)
            expect(query.isSuccess).toBe(true)
            expect(query.data).toEqual({label: "x", color: "y"})
        })

        it("allIds is empty initially", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            expect(store.get(mol.atoms.allIds)).toHaveLength(0)
        })
    })

    // ── Imperative getters ────────────────────────────────────────────────────

    describe("imperative getters", () => {
        it("get.data returns the entity", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id = mol.set.create({label: "x", color: "y"}, {store})
            expect(mol.get.data(id, {store})).toEqual({label: "x", color: "y"})
        })

        it("get.all returns all entities", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            mol.set.create({label: "a", color: "red"}, {store})
            mol.set.create({label: "b", color: "blue"}, {store})
            expect(mol.get.all({store})).toHaveLength(2)
        })

        it("get.allIds returns all IDs", () => {
            const mol = makeTagMolecule()
            const store = freshStore()
            const id1 = mol.set.create({label: "a", color: "red"}, {store})
            const id2 = mol.set.create({label: "b", color: "blue"}, {store})
            const ids = mol.get.allIds({store})
            expect(ids).toContain(id1)
            expect(ids).toContain(id2)
        })
    })

    // ── molecule metadata ─────────────────────────────────────────────────────

    describe("molecule metadata", () => {
        it("exposes the molecule name", () => {
            const mol = makeTagMolecule()
            expect(mol.name).toBe("tag")
        })

        it("exposes source as 'local'", () => {
            const mol = makeTagMolecule()
            expect(mol.source).toBe("local")
        })
    })
})
