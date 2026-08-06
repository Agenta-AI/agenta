/**
 * Unit tests for the loadable store atoms
 *
 * The loadable store is pure Jotai state — no API calls, no entity deps.
 * It tracks whether a data source is "local" (manual rows) or "connected"
 * (synced to a testset or trace), plus the columns, execution results,
 * and output mappings that belong to that loadable instance.
 *
 * Each test creates a fresh Jotai store so atoms don't bleed between tests.
 */

import {describe, it, expect} from "vitest"
import {createStore} from "jotai"

import {
    loadableStateAtomFamily,
    loadableModeAtomFamily,
    loadableColumnsAtomFamily,
    loadableExecutionResultsAtomFamily,
    loadableConnectedSourceAtomFamily,
    loadableLinkedRunnableAtomFamily,
    loadableOutputMappingsAtomFamily,
} from "../../src/loadable/store"

// ── Helpers ───────────────────────────────────────────────────────────────────

function freshStore() {
    return createStore()
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("loadable store", () => {
    // ── Default / initial state ───────────────────────────────────────────────

    describe("default state", () => {
        it("mode is 'local' when no source is connected", () => {
            const store = freshStore()
            expect(store.get(loadableModeAtomFamily("lb-1"))).toBe("local")
        })

        it("columns default to an empty array", () => {
            const store = freshStore()
            expect(store.get(loadableColumnsAtomFamily("lb-1"))).toEqual([])
        })

        it("execution results default to an empty object", () => {
            const store = freshStore()
            expect(store.get(loadableExecutionResultsAtomFamily("lb-1"))).toEqual({})
        })

        it("connected source defaults to all-null", () => {
            const store = freshStore()
            expect(store.get(loadableConnectedSourceAtomFamily("lb-1"))).toEqual({
                id: null,
                name: null,
                type: null,
            })
        })

        it("linked runnable defaults to all-null", () => {
            const store = freshStore()
            expect(store.get(loadableLinkedRunnableAtomFamily("lb-1"))).toEqual({
                type: null,
                id: null,
            })
        })

        it("output mappings default to an empty array", () => {
            const store = freshStore()
            expect(store.get(loadableOutputMappingsAtomFamily("lb-1"))).toEqual([])
        })
    })

    // ── Mode switching via state ──────────────────────────────────────────────

    describe("mode", () => {
        it("switches to 'connected' when connectedSourceId is set", () => {
            const store = freshStore()
            const stateAtom = loadableStateAtomFamily("lb-2")

            store.set(stateAtom, (prev) => ({...prev, connectedSourceId: "rev-abc"}))

            expect(store.get(loadableModeAtomFamily("lb-2"))).toBe("connected")
        })

        it("returns to 'local' when connectedSourceId is cleared", () => {
            const store = freshStore()
            const stateAtom = loadableStateAtomFamily("lb-2")

            store.set(stateAtom, (prev) => ({...prev, connectedSourceId: "rev-abc"}))
            store.set(stateAtom, (prev) => ({...prev, connectedSourceId: null}))

            expect(store.get(loadableModeAtomFamily("lb-2"))).toBe("local")
        })
    })

    // ── Connected source ──────────────────────────────────────────────────────

    describe("connected source", () => {
        it("reflects updated connected source information", () => {
            const store = freshStore()
            const stateAtom = loadableStateAtomFamily("lb-3")

            store.set(stateAtom, (prev) => ({
                ...prev,
                connectedSourceId: "rev-xyz",
                connectedSourceName: "My Testset v2",
                connectedSourceType: "testcase" as const,
            }))

            expect(store.get(loadableConnectedSourceAtomFamily("lb-3"))).toEqual({
                id: "rev-xyz",
                name: "My Testset v2",
                type: "testcase",
            })
        })
    })

    // ── Isolation between instances ───────────────────────────────────────────

    describe("instance isolation", () => {
        it("two loadable IDs do not share state", () => {
            const store = freshStore()
            const stateAtomA = loadableStateAtomFamily("lb-a")

            store.set(stateAtomA, (prev) => ({...prev, connectedSourceId: "rev-only-in-a"}))

            expect(store.get(loadableModeAtomFamily("lb-a"))).toBe("connected")
            expect(store.get(loadableModeAtomFamily("lb-b"))).toBe("local")
        })
    })

    // ── Output mappings ───────────────────────────────────────────────────────

    describe("output mappings", () => {
        it("reflects output mappings written to state", () => {
            const store = freshStore()
            const stateAtom = loadableStateAtomFamily("lb-4")
            const mapping = {id: "m-1", outputPath: "data.output", targetColumn: "result"}

            store.set(stateAtom, (prev) => ({...prev, outputMappings: [mapping]}))

            expect(store.get(loadableOutputMappingsAtomFamily("lb-4"))).toEqual([mapping])
        })
    })

    // ── Linked runnable ───────────────────────────────────────────────────────

    describe("linked runnable", () => {
        it("reflects the linked runnable when set", () => {
            const store = freshStore()
            const stateAtom = loadableStateAtomFamily("lb-5")

            store.set(stateAtom, (prev) => ({
                ...prev,
                linkedRunnableType: "appRevision" as const,
                linkedRunnableId: "run-001",
            }))

            expect(store.get(loadableLinkedRunnableAtomFamily("lb-5"))).toEqual({
                type: "appRevision",
                id: "run-001",
            })
        })
    })
})
