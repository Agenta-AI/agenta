/**
 * Unit tests for createMolecule
 *
 * createMolecule is the factory behind every server-backed entity (testcase,
 * testset, trace, environment, etc.). It wires together a TanStack Query atom
 * (the server source of truth) with a draft atom family (local edits) and
 * exposes a uniform API: atoms.*, reducers.*, get.*, set.*, lifecycle.
 *
 * The server query is replaced with a controllable mock so tests are fully
 * synchronous — no network, no React, no timers.
 *
 * Uses a simple "Post" entity type to keep fixtures readable.
 */

import {describe, it, expect, vi, beforeEach} from "vitest"
import {atom, createStore} from "jotai"
import {atomFamily} from "jotai-family"

import {createMolecule} from "../../src/shared/molecule/createMolecule"
import type {QueryState} from "../../src/shared/molecule/types"

// ── Fixture type ──────────────────────────────────────────────────────────────

type Post = {
    id: string
    title: string
    body: string
}

type PostDraft = Partial<Post>

// ── Setup helpers ─────────────────────────────────────────────────────────────

/**
 * Build a fresh molecule + store + server data controls for each test.
 *
 * The mock queryAtomFamily reads from writable serverAtomFamily atoms, so
 * tests can seed server state with:
 *   store.set(serverAtomFamily("post-1"), serverPost)
 */
function makeSetup(overrides?: Partial<Parameters<typeof createMolecule<Post, PostDraft>>[0]>) {
    // Writable server data atoms — test controls these directly
    const serverAtomFamily = atomFamily((_id: string) => atom<Post | null>(null))

    // Mock query atom family — reads from serverAtomFamily, always non-pending
    const queryAtomFamily = atomFamily((id: string) =>
        atom<QueryState<Post>>((get) => ({
            data: get(serverAtomFamily(id)),
            isPending: false,
            isError: false,
            error: null,
        })),
    )

    // Draft atom family — writable, starts as null (no local edits)
    const draftAtomFamily = atomFamily((_id: string) => atom<PostDraft | null>(null))

    const mol = createMolecule<Post, PostDraft>({
        name: "post",
        queryAtomFamily,
        draftAtomFamily,
        ...overrides,
    })

    const store = createStore()

    return {mol, store, serverAtomFamily, draftAtomFamily}
}

const serverPost: Post = {id: "post-1", title: "Hello", body: "World"}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("createMolecule", () => {
    // ── Server data and merge ─────────────────────────────────────────────────

    describe("server data", () => {
        it("data atom returns server entity when no draft exists", () => {
            const {mol, store, serverAtomFamily} = makeSetup()
            store.set(serverAtomFamily("post-1"), serverPost)
            expect(store.get(mol.atoms.data("post-1"))).toEqual(serverPost)
        })

        it("data atom returns null when entity is not in server state", () => {
            const {mol, store} = makeSetup()
            expect(store.get(mol.atoms.data("missing"))).toBeNull()
        })

        it("serverData atom returns the raw server entity", () => {
            const {mol, store, serverAtomFamily} = makeSetup()
            store.set(serverAtomFamily("post-1"), serverPost)
            expect(store.get(mol.atoms.serverData("post-1"))).toEqual(serverPost)
        })
    })

    // ── Transform ─────────────────────────────────────────────────────────────

    describe("transform", () => {
        it("applies transform to server data before exposing it", () => {
            const {mol, store, serverAtomFamily} = makeSetup({
                transform: (post) => ({...post, title: post.title.toUpperCase()}),
            })
            store.set(serverAtomFamily("post-1"), serverPost)
            expect(store.get(mol.atoms.data("post-1"))?.title).toBe("HELLO")
        })
    })

    // ── Draft operations ──────────────────────────────────────────────────────

    describe("draft operations", () => {
        let store: ReturnType<typeof createStore>
        let mol: ReturnType<typeof makeSetup>["mol"]
        let serverAtomFamily: ReturnType<typeof makeSetup>["serverAtomFamily"]

        beforeEach(() => {
            ;({mol, store, serverAtomFamily} = makeSetup())
            store.set(serverAtomFamily("post-1"), serverPost)
        })

        it("update reducer merges changes into draft", () => {
            store.set(mol.reducers.update, "post-1", {title: "Updated"})
            expect(store.get(mol.atoms.data("post-1"))?.title).toBe("Updated")
            expect(store.get(mol.atoms.data("post-1"))?.body).toBe("World")
        })

        it("update accumulates across multiple calls", () => {
            store.set(mol.reducers.update, "post-1", {title: "New title"})
            store.set(mol.reducers.update, "post-1", {body: "New body"})
            const data = store.get(mol.atoms.data("post-1"))
            expect(data?.title).toBe("New title")
            expect(data?.body).toBe("New body")
        })

        it("isDirty is false before any update", () => {
            expect(store.get(mol.atoms.isDirty("post-1"))).toBe(false)
        })

        it("isDirty is true after an update", () => {
            store.set(mol.reducers.update, "post-1", {title: "Changed"})
            expect(store.get(mol.atoms.isDirty("post-1"))).toBe(true)
        })

        it("discard reducer clears draft and restores server state", () => {
            store.set(mol.reducers.update, "post-1", {title: "Pending"})
            store.set(mol.reducers.discard, "post-1")
            expect(store.get(mol.atoms.data("post-1"))).toEqual(serverPost)
            expect(store.get(mol.atoms.isDirty("post-1"))).toBe(false)
        })

        it("draft atom is null before any update", () => {
            expect(store.get(mol.atoms.draft("post-1"))).toBeNull()
        })

        it("draft atom holds the pending changes after update", () => {
            store.set(mol.reducers.update, "post-1", {title: "Staged"})
            expect(store.get(mol.atoms.draft("post-1"))).toMatchObject({title: "Staged"})
        })
    })

    // ── Custom merge ──────────────────────────────────────────────────────────

    describe("custom merge", () => {
        it("uses the provided merge function to combine server + draft", () => {
            const {mol, store, serverAtomFamily} = makeSetup({
                merge: (server, draft) => {
                    if (!server) return null
                    if (!draft) return server
                    return {...server, title: `${server.title} [${draft.title}]`}
                },
            })
            store.set(serverAtomFamily("post-1"), serverPost)
            store.set(mol.reducers.update, "post-1", {title: "Draft"})
            expect(store.get(mol.atoms.data("post-1"))?.title).toBe("Hello [Draft]")
        })
    })

    // ── Soft delete ───────────────────────────────────────────────────────────

    describe("soft delete", () => {
        it("delete reducer marks entity as deleted", () => {
            const {mol, store} = makeSetup()
            store.set(mol.reducers.delete, "post-1")
            expect(store.get(mol.atoms.isDeleted("post-1"))).toBe(true)
        })

        it("deletedIds atom contains the deleted ID", () => {
            const {mol, store} = makeSetup()
            store.set(mol.reducers.delete, "post-1")
            expect(store.get(mol.atoms.deletedIds).has("post-1")).toBe(true)
        })

        it("restore reducer removes entity from deleted set", () => {
            const {mol, store} = makeSetup()
            store.set(mol.reducers.delete, "post-1")
            store.set(mol.reducers.restore, "post-1")
            expect(store.get(mol.atoms.isDeleted("post-1"))).toBe(false)
        })

        it("isDeleted is false initially", () => {
            const {mol, store} = makeSetup()
            expect(store.get(mol.atoms.isDeleted("post-1"))).toBe(false)
        })
    })

    // ── Local entity creation ─────────────────────────────────────────────────

    describe("local entity creation", () => {
        it("create reducer adds generated ID to newIds", () => {
            const {mol, store} = makeSetup()
            store.set(mol.reducers.create, {title: "New post", body: "..."})
            expect(store.get(mol.atoms.newIds)).toHaveLength(1)
        })

        it("generated ID starts with 'new-'", () => {
            const {mol, store} = makeSetup()
            store.set(mol.reducers.create)
            const [id] = store.get(mol.atoms.newIds)
            expect(id.startsWith("new-")).toBe(true)
        })

        it("multiple creates each produce a unique ID", () => {
            const {mol, store} = makeSetup()
            store.set(mol.reducers.create)
            store.set(mol.reducers.create)
            const ids = store.get(mol.atoms.newIds)
            expect(new Set(ids).size).toBe(2)
        })
    })

    // ── isNew detection ───────────────────────────────────────────────────────

    describe("isNew detection", () => {
        it("IDs starting with 'new-' are considered new", () => {
            const {mol, store} = makeSetup()
            expect(store.get(mol.atoms.isNew("new-123"))).toBe(true)
        })

        it("IDs starting with 'local-' are considered new", () => {
            const {mol, store} = makeSetup()
            expect(store.get(mol.atoms.isNew("local-abc"))).toBe(true)
        })

        it("regular IDs are not new", () => {
            const {mol, store} = makeSetup()
            expect(store.get(mol.atoms.isNew("post-1"))).toBe(false)
        })

        it("custom isNewEntity function overrides default", () => {
            const {mol, store} = makeSetup({
                isNewEntity: (id) => id.startsWith("draft-"),
            })
            expect(store.get(mol.atoms.isNew("draft-abc"))).toBe(true)
            expect(store.get(mol.atoms.isNew("new-abc"))).toBe(false)
        })
    })

    // ── Imperative API ────────────────────────────────────────────────────────

    describe("imperative API", () => {
        it("get.data returns entity data", () => {
            const {mol, store, serverAtomFamily} = makeSetup()
            store.set(serverAtomFamily("post-1"), serverPost)
            expect(mol.get.data("post-1", {store})).toEqual(serverPost)
        })

        it("get.isDirty returns false before any update", () => {
            const {mol, store, serverAtomFamily} = makeSetup()
            store.set(serverAtomFamily("post-1"), serverPost)
            expect(mol.get.isDirty("post-1", {store})).toBe(false)
        })

        it("set.update changes data via imperative API", () => {
            const {mol, store, serverAtomFamily} = makeSetup()
            store.set(serverAtomFamily("post-1"), serverPost)
            mol.set.update("post-1", {title: "Imperative"}, {store})
            expect(mol.get.data("post-1", {store})?.title).toBe("Imperative")
            expect(mol.get.isDirty("post-1", {store})).toBe(true)
        })

        it("set.discard reverts to server state", () => {
            const {mol, store, serverAtomFamily} = makeSetup()
            store.set(serverAtomFamily("post-1"), serverPost)
            mol.set.update("post-1", {title: "Changed"}, {store})
            mol.set.discard("post-1", {store})
            expect(mol.get.data("post-1", {store})).toEqual(serverPost)
        })

        it("set.create returns the generated ID", () => {
            const {mol, store} = makeSetup()
            const id = mol.set.create({title: "New"}, {store})
            expect(id.startsWith("new-")).toBe(true)
        })

        it("set.delete marks entity as deleted", () => {
            const {mol, store} = makeSetup()
            mol.set.delete("post-1", {store})
            expect(store.get(mol.atoms.isDeleted("post-1"))).toBe(true)
        })

        it("set.restore removes entity from deleted set", () => {
            const {mol, store} = makeSetup()
            mol.set.delete("post-1", {store})
            mol.set.restore("post-1", {store})
            expect(store.get(mol.atoms.isDeleted("post-1"))).toBe(false)
        })
    })

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    describe("lifecycle", () => {
        it("fires onMount callback when serverData atom is first accessed", () => {
            const onMount = vi.fn()
            const {mol, store} = makeSetup({lifecycle: {onMount}})
            // Accessing the serverData atom triggers mount
            store.get(mol.atoms.serverData("post-lifecycle"))
            expect(onMount).toHaveBeenCalledWith("post-lifecycle")
        })

        it("fires onMount only once per ID, not on repeated access", () => {
            const onMount = vi.fn()
            const {mol, store} = makeSetup({lifecycle: {onMount}})
            store.get(mol.atoms.serverData("post-lifecycle"))
            store.get(mol.atoms.serverData("post-lifecycle"))
            expect(onMount).toHaveBeenCalledOnce()
        })

        it("fires onUnmount callback when cleanup.remove is called", () => {
            const onUnmount = vi.fn()
            const {mol, store} = makeSetup({lifecycle: {onUnmount}})
            store.get(mol.atoms.serverData("post-2"))
            mol.cleanup.remove("post-2")
            expect(onUnmount).toHaveBeenCalledWith("post-2")
        })

        it("lifecycle.isActive returns true after first access", () => {
            const {mol, store} = makeSetup()
            store.get(mol.atoms.serverData("post-3"))
            expect(mol.lifecycle.isActive("post-3")).toBe(true)
        })

        it("lifecycle.isActive returns false after cleanup.remove", () => {
            const {mol, store} = makeSetup()
            store.get(mol.atoms.serverData("post-4"))
            mol.cleanup.remove("post-4")
            expect(mol.lifecycle.isActive("post-4")).toBe(false)
        })
    })

    // ── molecule metadata ─────────────────────────────────────────────────────

    describe("molecule metadata", () => {
        it("exposes the molecule name", () => {
            const {mol} = makeSetup()
            expect(mol.name).toBe("post")
        })
    })
})
