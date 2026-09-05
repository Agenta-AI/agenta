/**
 * Regression guard for #6493: an individually switched-off build-kit tool (and the master off)
 * must survive a page reload. The UI state is persisted to localStorage; a page reload re-evaluates
 * the store module, whose `getOnInit` storage read seeds the atom from what the previous load wrote.
 * Here `vi.resetModules()` + a fresh import stands in for that reload.
 */
import {createStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

// Node test env has no localStorage; a minimal Storage stub lets atomWithStorage persist.
// jotai's default storage reads `window.localStorage`, so the stub is hung off a stub window.
// The backing map outlives module resets so a re-import (the "reload") sees prior writes.
class MemoryStorage {
    constructor(private store: Map<string, string>) {}
    get length() {
        return this.store.size
    }
    clear() {
        this.store.clear()
    }
    getItem(key: string) {
        return this.store.get(key) ?? null
    }
    key(index: number) {
        return [...this.store.keys()][index] ?? null
    }
    removeItem(key: string) {
        this.store.delete(key)
    }
    setItem(key: string, value: string) {
        this.store.set(key, value)
    }
}

const REVISION = "rev-agent-1"

type StoreModule = typeof import("../../src/workflow/state/store")

/** Fresh module evaluation against the shared storage — a stand-in for a page load/reload. */
async function loadStore(backing: Map<string, string>): Promise<StoreModule> {
    vi.stubGlobal("window", {localStorage: new MemoryStorage(backing)})
    vi.resetModules()
    return import("../../src/workflow/state/store")
}

describe("build-kit UI state persistence", () => {
    let backing: Map<string, string>

    beforeEach(() => {
        backing = new Map()
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it("defaults to enabled with no disabled ops", async () => {
        const mod = await loadStore(backing)
        const store = createStore()
        expect(store.get(mod.workflowBuildKitEnabledAtomFamily(REVISION))).toBe(true)
        expect(store.get(mod.workflowBuildKitDisabledOpsAtomFamily(REVISION))).toEqual([])
    })

    it("persists a switched-off tool across a reload", async () => {
        const first = await loadStore(backing)
        createStore().set(first.workflowBuildKitDisabledOpsAtomFamily(REVISION), ["read_file"])

        const reloaded = await loadStore(backing)
        const store = createStore()
        expect(store.get(reloaded.workflowBuildKitDisabledOpsAtomFamily(REVISION))).toEqual([
            "read_file",
        ])
        // The master flag is untouched by a tool toggle.
        expect(store.get(reloaded.workflowBuildKitEnabledAtomFamily(REVISION))).toBe(true)
    })

    it("persists the master off across a reload", async () => {
        const first = await loadStore(backing)
        createStore().set(first.workflowBuildKitEnabledAtomFamily(REVISION), false)

        const reloaded = await loadStore(backing)
        expect(createStore().get(reloaded.workflowBuildKitEnabledAtomFamily(REVISION))).toBe(false)
    })

    it("falls back to defaults when the persisted record is the wrong shape", async () => {
        backing.set(
            "agenta:playground:build-kit",
            JSON.stringify({[REVISION]: {enabled: "yes", disabledOps: "read_file"}}),
        )
        const mod = await loadStore(backing)
        const store = createStore()
        expect(store.get(mod.workflowBuildKitEnabledAtomFamily(REVISION))).toBe(true)
        expect(store.get(mod.workflowBuildKitDisabledOpsAtomFamily(REVISION))).toEqual([])
    })

    it("keeps each revision's state independent", async () => {
        const first = await loadStore(backing)
        const writeStore = createStore()
        writeStore.set(first.workflowBuildKitDisabledOpsAtomFamily("rev-a"), ["read_file"])
        writeStore.set(first.workflowBuildKitDisabledOpsAtomFamily("rev-b"), ["write_file"])

        const reloaded = await loadStore(backing)
        const store = createStore()
        expect(store.get(reloaded.workflowBuildKitDisabledOpsAtomFamily("rev-a"))).toEqual([
            "read_file",
        ])
        expect(store.get(reloaded.workflowBuildKitDisabledOpsAtomFamily("rev-b"))).toEqual([
            "write_file",
        ])
    })
})
