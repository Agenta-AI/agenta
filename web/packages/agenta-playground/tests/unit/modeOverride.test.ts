/**
 * Unit tests for the playground mode override atoms.
 *
 * The override decouples the app's capability (`is_chat`: the workflow
 * accepts a `messages` input) from the playground's behavior (chat vs
 * completion UI and run semantics). Contract under test:
 *
 * - completion apps always get completion behavior; the override is inert
 * - chat apps default to chat behavior and can be overridden to completion
 * - writing the capability default (or null) removes the stored entry
 * - the override is scoped per app (`workflow_id`), not per revision
 *
 * Design doc: docs/design/playground-mode-switch/
 *
 * The workflow molecule is mocked with writable data atoms; `executionMode`
 * derives from `flags.is_chat` exactly like the real selector's first check.
 */
import {createStore, type PrimitiveAtom} from "jotai"
import {describe, expect, it, beforeEach} from "vitest"
import {vi} from "vitest"

vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const dataAtoms = new Map<string, unknown>()
    const dataFor = (id: string) => {
        if (!dataAtoms.has(id)) {
            dataAtoms.set(id, atom<Record<string, unknown> | null>(null))
        }
        return dataAtoms.get(id)
    }
    return {
        workflowMolecule: {
            selectors: {
                data: dataFor,
                executionMode: (id: string) =>
                    atom((get) => {
                        const entity = get(
                            dataFor(id) as PrimitiveAtom<{
                                flags?: {is_chat?: boolean}
                            } | null>,
                        )
                        return entity?.flags?.is_chat ? "chat" : "completion"
                    }),
            },
        },
    }
})

import {workflowMolecule} from "@agenta/entities/workflow"

import {
    playgroundCapabilityModeAtom,
    playgroundIsChatBehaviorAtom,
    playgroundModeOverrideAtom,
} from "../../src/state/atoms/modeOverride"
import {playgroundNodesAtom} from "../../src/state/atoms/playground"
import type {PlaygroundNode} from "../../src/state/types"

type EntityData = {flags?: {is_chat?: boolean}; workflow_id?: string | null} | null

function seedEntity(store: ReturnType<typeof createStore>, entityId: string, data: EntityData) {
    store.set(workflowMolecule.selectors.data(entityId) as PrimitiveAtom<EntityData>, data)
}

function setRootNode(store: ReturnType<typeof createStore>, entityId: string) {
    const node: PlaygroundNode = {
        id: `node-${entityId}`,
        entityType: "workflow" as PlaygroundNode["entityType"],
        entityId,
        depth: 0,
    }
    store.set(playgroundNodesAtom, [node])
}

describe("playground mode override", () => {
    let store: ReturnType<typeof createStore>

    beforeEach(() => {
        store = createStore()
        // The storage atom is module-level; clear leftovers between tests by
        // resetting through the public setter once a scope exists.
    })

    it("is undefined with no root node, and the setter is a no-op", () => {
        expect(store.get(playgroundCapabilityModeAtom)).toBeUndefined()
        expect(store.get(playgroundIsChatBehaviorAtom)).toBeUndefined()
        expect(store.get(playgroundModeOverrideAtom)).toBeNull()

        store.set(playgroundModeOverrideAtom, "completion")
        expect(store.get(playgroundModeOverrideAtom)).toBeNull()
    })

    it("completion apps get completion behavior and the override is inert", () => {
        seedEntity(store, "rev-comp", {flags: {is_chat: false}, workflow_id: "app-comp"})
        setRootNode(store, "rev-comp")

        expect(store.get(playgroundCapabilityModeAtom)).toBe("completion")
        expect(store.get(playgroundIsChatBehaviorAtom)).toBe(false)

        store.set(playgroundModeOverrideAtom, "chat")
        expect(store.get(playgroundIsChatBehaviorAtom)).toBe(false)

        store.set(playgroundModeOverrideAtom, null)
    })

    it("chat apps default to chat behavior", () => {
        seedEntity(store, "rev-chat", {flags: {is_chat: true}, workflow_id: "app-chat"})
        setRootNode(store, "rev-chat")

        expect(store.get(playgroundCapabilityModeAtom)).toBe("chat")
        expect(store.get(playgroundModeOverrideAtom)).toBeNull()
        expect(store.get(playgroundIsChatBehaviorAtom)).toBe(true)
    })

    it("a completion override flips a chat app to completion behavior, and clears", () => {
        seedEntity(store, "rev-chat2", {flags: {is_chat: true}, workflow_id: "app-chat2"})
        setRootNode(store, "rev-chat2")

        store.set(playgroundModeOverrideAtom, "completion")
        expect(store.get(playgroundModeOverrideAtom)).toBe("completion")
        expect(store.get(playgroundIsChatBehaviorAtom)).toBe(false)

        store.set(playgroundModeOverrideAtom, null)
        expect(store.get(playgroundModeOverrideAtom)).toBeNull()
        expect(store.get(playgroundIsChatBehaviorAtom)).toBe(true)
    })

    it("writing the capability default removes the stored entry", () => {
        seedEntity(store, "rev-chat3", {flags: {is_chat: true}, workflow_id: "app-chat3"})
        setRootNode(store, "rev-chat3")

        store.set(playgroundModeOverrideAtom, "completion")
        expect(store.get(playgroundModeOverrideAtom)).toBe("completion")

        // "chat" is this app's capability default: normalized to removal.
        store.set(playgroundModeOverrideAtom, "chat")
        expect(store.get(playgroundModeOverrideAtom)).toBeNull()
        expect(store.get(playgroundIsChatBehaviorAtom)).toBe(true)
    })

    it("scopes the override per app, surviving revision switches", () => {
        seedEntity(store, "rev-a1", {flags: {is_chat: true}, workflow_id: "app-a"})
        seedEntity(store, "rev-a2", {flags: {is_chat: true}, workflow_id: "app-a"})
        seedEntity(store, "rev-b", {flags: {is_chat: true}, workflow_id: "app-b"})

        setRootNode(store, "rev-a1")
        store.set(playgroundModeOverrideAtom, "completion")
        expect(store.get(playgroundIsChatBehaviorAtom)).toBe(false)

        // Another app is unaffected.
        setRootNode(store, "rev-b")
        expect(store.get(playgroundModeOverrideAtom)).toBeNull()
        expect(store.get(playgroundIsChatBehaviorAtom)).toBe(true)

        // A different revision of the same app keeps the override.
        setRootNode(store, "rev-a2")
        expect(store.get(playgroundModeOverrideAtom)).toBe("completion")
        expect(store.get(playgroundIsChatBehaviorAtom)).toBe(false)

        store.set(playgroundModeOverrideAtom, null)
    })

    it("falls back to the entity id as scope key when workflow_id is missing", () => {
        seedEntity(store, "local-draft", {flags: {is_chat: true}, workflow_id: null})
        setRootNode(store, "local-draft")

        store.set(playgroundModeOverrideAtom, "completion")
        expect(store.get(playgroundModeOverrideAtom)).toBe("completion")
        expect(store.get(playgroundIsChatBehaviorAtom)).toBe(false)

        store.set(playgroundModeOverrideAtom, null)
    })
})
