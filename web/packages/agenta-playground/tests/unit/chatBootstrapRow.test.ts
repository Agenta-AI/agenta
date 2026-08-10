/**
 * Unit tests for chat mode's blank first user message (#5344).
 *
 * That row used to be created from inside `generationRowIdsAtom`'s READ function. Jotai flags a
 * store write during a read, and it is not only a warning: `cancelTestsMutationAtom` reads the row
 * ids from inside a write, so cancelling on an empty chat could re-entrantly create the row
 * mid-write. The read is now pure and the creation moved to `ensureChatBootstrapRowAtom`.
 *
 * Contract under test:
 * - reading `generationRowIdsAtom` never creates a row (the regression this issue is about)
 * - `ensureChatBootstrapRowAtom` creates exactly one row for an empty chat playground
 * - it is idempotent — repeated calls in the same store still yield one row
 * - it no-ops for agents, which carry `is_chat` but never render the row
 * - it no-ops for completion apps and while the entity is still loading
 *
 * The workflow molecule is mocked with writable data atoms: `executionMode` drives chat capability
 * (as in `modeOverride.test.ts`) and `workflowType` drives agent detection (as in `agentMode.test.ts`).
 */
import type {PlaygroundNode} from "@agenta/entities/runnable"
import {createStore, type PrimitiveAtom} from "jotai"
import {beforeEach, describe, expect, it, vi} from "vitest"

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const actual = (await importOriginal()) as any
    const {atom} = await import("jotai")
    const modeAtoms = new Map<string, unknown>()
    const typeAtoms = new Map<string, unknown>()
    const dataAtoms = new Map<string, unknown>()
    const memo = (map: Map<string, unknown>, id: string, make: () => unknown) => {
        if (!map.has(id)) map.set(id, make())
        return map.get(id)
    }
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                data: (id: string) => memo(dataAtoms, id, () => atom<unknown>(null)),
                executionMode: (id: string) =>
                    memo(modeAtoms, id, () => atom<string>("completion")),
                workflowType: (id: string) => memo(typeAtoms, id, () => atom<string>("completion")),
            },
        },
    }
})

import {workflowMolecule} from "@agenta/entities/workflow"

import {playgroundNodesAtom, playgroundStoreAtom} from "../../src/state/atoms/playground"
import {sharedMessageIdsAtomFamily} from "../../src/state/chat/messageSelectors"
import {
    ensureChatBootstrapRowAtom,
    generationRowIdsAtom,
    needsChatBootstrapRowAtom,
} from "../../src/state/execution/selectors"

type Store = ReturnType<typeof createStore>

/** `derivedLoadableIdAtom` builds this from the depth-0 node. */
const loadableIdFor = (entityId: string) => `testset:revision:${entityId}`

const node = (entityId: string): PlaygroundNode => ({
    id: `node-${entityId}`,
    entityType: "revision",
    entityId,
    depth: 0,
})

/**
 * Point a store's playground at one entity of the given kind.
 * `chat` and `agent` are both chat-capable — that overlap is the reason the agent guard exists.
 */
const mountEntity = (store: Store, entityId: string, kind: "chat" | "agent" | "completion") => {
    store.set(
        workflowMolecule.selectors.executionMode(entityId) as PrimitiveAtom<string>,
        kind === "completion" ? "completion" : "chat",
    )
    store.set(workflowMolecule.selectors.workflowType(entityId) as PrimitiveAtom<string>, kind)
    store.set(playgroundNodesAtom, [node(entityId)])
    return loadableIdFor(entityId)
}

const rowCount = (store: Store, loadableId: string) =>
    store.get(sharedMessageIdsAtomFamily(loadableId)).length

describe("chat bootstrap row", () => {
    let store: Store
    beforeEach(() => {
        store = createStore()
        // `playgroundStoreAtom` defaults to jotai's GLOBAL store, and the impure read wrote through
        // it. Without this the write would land in the default store while the assertions read an
        // isolated one, and the purity test below would pass whether or not the bug is present.
        store.set(playgroundStoreAtom, store)
    })

    describe("generationRowIdsAtom (read purity)", () => {
        it("does not create a row when read on an empty chat playground", () => {
            const loadableId = mountEntity(store, "read-pure", "chat")

            expect(store.get(generationRowIdsAtom)).toEqual([])
            expect(store.get(generationRowIdsAtom)).toEqual([])

            expect(rowCount(store, loadableId)).toBe(0)
        })
    })

    describe("ensureChatBootstrapRowAtom", () => {
        it("creates the blank row for an empty chat playground", () => {
            const loadableId = mountEntity(store, "chat-1", "chat")
            expect(store.get(needsChatBootstrapRowAtom)).toBe(true)

            store.set(ensureChatBootstrapRowAtom)

            expect(rowCount(store, loadableId)).toBe(1)
            expect(store.get(generationRowIdsAtom)).toHaveLength(1)
            expect(store.get(needsChatBootstrapRowAtom)).toBe(false)
        })

        it("is idempotent — repeated calls still yield exactly one row", () => {
            const loadableId = mountEntity(store, "chat-2", "chat")

            store.set(ensureChatBootstrapRowAtom)
            store.set(ensureChatBootstrapRowAtom)
            store.set(ensureChatBootstrapRowAtom)

            expect(rowCount(store, loadableId)).toBe(1)
        })

        it("no-ops for an agent — it is chat-capable but never renders the row", () => {
            const loadableId = mountEntity(store, "agent-1", "agent")
            expect(store.get(needsChatBootstrapRowAtom)).toBe(false)

            store.set(ensureChatBootstrapRowAtom)

            expect(rowCount(store, loadableId)).toBe(0)
        })

        it("no-ops for a completion app", () => {
            const loadableId = mountEntity(store, "completion-1", "completion")
            expect(store.get(needsChatBootstrapRowAtom)).toBe(false)

            store.set(ensureChatBootstrapRowAtom)

            expect(rowCount(store, loadableId)).toBe(0)
        })

        it("no-ops while the playground has no node yet", () => {
            expect(store.get(needsChatBootstrapRowAtom)).toBe(false)
            expect(() => store.set(ensureChatBootstrapRowAtom)).not.toThrow()
        })
    })
})
