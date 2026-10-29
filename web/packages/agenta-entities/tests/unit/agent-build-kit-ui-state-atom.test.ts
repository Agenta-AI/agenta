import {createStore} from "jotai"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

class MemoryStorage {
    constructor(private backing: Map<string, string>) {}
    getItem(key: string) {
        return this.backing.get(key) ?? null
    }
    setItem(key: string, value: string) {
        this.backing.set(key, value)
    }
    removeItem(key: string) {
        this.backing.delete(key)
    }
}

await import("../../src/workflow/state/store")
type StoreModule = typeof import("../../src/workflow/state/store")
async function load(backing: Map<string, string>) {
    vi.stubGlobal("window", {localStorage: new MemoryStorage(backing)})
    vi.resetModules()
    const mod = await import("../../src/workflow/state/store")
    const store = createStore()
    store.set(mod.workflowProjectIdAtom, "project")
    return {mod, store}
}
function seed(
    mod: StoreModule,
    store: ReturnType<typeof createStore>,
    revision: string,
    agent: string,
) {
    store.set(mod.workflowLocalServerDataAtomFamily(revision), {
        id: revision,
        workflow_id: agent,
        data: {},
        flags: {is_agent: true},
    } as never)
}

describe("agent build kit policy", () => {
    let backing: Map<string, string>
    beforeEach(() => {
        backing = new Map()
    })
    afterEach(() => vi.unstubAllGlobals())

    it("defaults to allow all", async () => {
        const {mod, store} = await load(backing)
        expect(store.get(mod.workflowBuildKitUiStateAtomFamily("rev"))).toEqual({
            enabled: true,
            disabledOps: [],
        })
    })

    it("keeps choices across manual and assistant revisions, older revisions and reload", async () => {
        const {mod, store} = await load(backing)
        for (const rev of ["old", "manual", "assistant"]) seed(mod, store, rev, "agent-a")
        const state = {
            enabled: true,
            disabledOps: ["remove_schedule"],
            permissionOverrides: {create_schedule: "ask" as const},
        }
        store.set(mod.workflowBuildKitUiStateAtomFamily("old"), state)
        expect(store.get(mod.workflowBuildKitUiStateAtomFamily("manual"))).toEqual(state)
        expect(store.get(mod.workflowBuildKitUiStateAtomFamily("assistant"))).toEqual(state)
        const reloaded = await load(backing)
        seed(reloaded.mod, reloaded.store, "another-revision", "agent-a")
        expect(
            reloaded.store.get(reloaded.mod.workflowBuildKitUiStateAtomFamily("another-revision")),
        ).toEqual(state)
    })

    it("keeps agents and projects independent", async () => {
        const {mod, store} = await load(backing)
        seed(mod, store, "a", "agent-a")
        seed(mod, store, "b", "agent-b")
        store.set(mod.workflowBuildKitEnabledAtomFamily("a"), false)
        expect(store.get(mod.workflowBuildKitEnabledAtomFamily("b"))).toBe(true)
        store.set(mod.workflowProjectIdAtom, "another-project")
        expect(store.get(mod.workflowBuildKitEnabledAtomFamily("a"))).toBe(true)
    })

    it("migrates legacy state once, without letting old revisions overwrite agent policy", async () => {
        backing.set(
            "agenta:playground:build-kit",
            JSON.stringify({
                old: {enabled: false, disabledOps: ["remove_schedule"]},
                older: {enabled: true, disabledOps: []},
            }),
        )
        const {mod, store} = await load(backing)
        seed(mod, store, "old", "agent")
        seed(mod, store, "older", "agent")
        seed(mod, store, "new", "agent")
        store.set(mod.migrateBuildKitStateAtom, "old")
        store.set(mod.migrateBuildKitStateAtom, "older")
        expect(store.get(mod.workflowBuildKitUiStateAtomFamily("new"))).toEqual({
            enabled: false,
            disabledOps: ["remove_schedule"],
        })
    })

    it("does not reserve the agent scope before there is a policy to migrate", async () => {
        backing.set(
            "agenta:playground:build-kit",
            JSON.stringify({old: {enabled: true, disabledOps: ["remove_schedule"]}}),
        )
        const {mod, store} = await load(backing)
        seed(mod, store, "new", "agent")
        seed(mod, store, "old", "agent")
        store.set(mod.migrateBuildKitStateAtom, "new")
        expect(backing.has("agenta:playground:build-kit:agents")).toBe(false)
        store.set(mod.migrateBuildKitStateAtom, "old")
        expect(store.get(mod.workflowBuildKitDisabledOpsAtomFamily("new"))).toEqual([
            "remove_schedule",
        ])
    })

    it("transfers staging choices once to a newly created agent", async () => {
        const {mod, store} = await load(backing)
        store.set(mod.workflowBuildKitUiStateAtomFamily("local-new"), {
            enabled: false,
            disabledOps: [],
            permissionDefault: "ask",
        })
        store.set(mod.transferBuildKitStateAtom, {revisionId: "local-new", workflowId: "agent"})
        seed(mod, store, "committed", "agent")
        expect(store.get(mod.workflowBuildKitUiStateAtomFamily("committed"))).toEqual({
            enabled: false,
            disabledOps: [],
            permissionDefault: "ask",
        })
        store.set(mod.transferBuildKitStateAtom, {revisionId: "another", workflowId: "agent"})
        expect(store.get(mod.workflowBuildKitEnabledAtomFamily("committed"))).toBe(false)
    })

    it("does not write without project or identity", async () => {
        const {mod, store} = await load(backing)
        store.set(mod.workflowBuildKitEnabledAtomFamily(""), false)
        store.set(mod.workflowProjectIdAtom, null)
        store.set(mod.workflowBuildKitEnabledAtomFamily("a"), false)
        expect(backing.size).toBe(0)
    })

    it("normalizes malformed storage without throwing", async () => {
        backing.set("agenta:playground:build-kit:agents", "null")
        backing.set(
            "agenta:playground:build-kit",
            JSON.stringify({
                rev: {enabled: "yes", disabledOps: "bad", permissionOverrides: ["bad"]},
            }),
        )
        const {mod, store} = await load(backing)
        expect(store.get(mod.workflowBuildKitUiStateAtomFamily("rev"))).toEqual({
            enabled: true,
            disabledOps: [],
        })
    })
})
