/**
 * Unit tests for `isAgentModeAtomFamily` — the per-entity agent-mode flag the
 * playground's third generation arm branches on.
 *
 * Contract under test:
 * - true when the entity's `workflowType === "agent"` (derived from the backend `is_agent` flag)
 * - disjoint from chat/completion: a chat- or completion-type entity is NOT
 *   agent (guards the both-true hazard the `ExecutionItems` ternary relies on)
 * - per-entity: two entities in the same store resolve independently (mixed
 *   comparison grids must not misroute)
 *
 * The workflow molecule is mocked with a writable atom for `workflowType`.
 */
import {createStore, type PrimitiveAtom} from "jotai"
import {describe, expect, it, beforeEach, vi} from "vitest"

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const actual = (await importOriginal()) as any
    const {atom} = await import("jotai")
    const typeAtoms = new Map<string, unknown>()
    const typeFor = (id: string) => {
        if (!typeAtoms.has(id)) typeAtoms.set(id, atom<string>("completion"))
        return typeAtoms.get(id)
    }
    // Keep the rest of the module real (snapshot adapters, etc.); swap only the
    // selector this atom reads.
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                workflowType: typeFor,
            },
        },
    }
})

import {workflowMolecule} from "@agenta/entities/workflow"

import {isAgentModeAtomFamily} from "../../src/state/execution/selectors"

const setType = (store: ReturnType<typeof createStore>, id: string, type: string) =>
    store.set(workflowMolecule.selectors.workflowType(id) as PrimitiveAtom<string>, type)

describe("isAgentModeAtomFamily", () => {
    let store: ReturnType<typeof createStore>
    beforeEach(() => {
        store = createStore()
    })

    it("is true for an agent-type entity", () => {
        setType(store, "e1", "agent")
        expect(store.get(isAgentModeAtomFamily("e1"))).toBe(true)
    })

    it("is false for chat- and completion-type entities (disjoint)", () => {
        setType(store, "chatE", "chat")
        setType(store, "compE", "completion")
        expect(store.get(isAgentModeAtomFamily("chatE"))).toBe(false)
        expect(store.get(isAgentModeAtomFamily("compE"))).toBe(false)
    })

    it("is false for a custom-type entity (no agent flag)", () => {
        setType(store, "c", "custom")
        expect(store.get(isAgentModeAtomFamily("c"))).toBe(false)
    })

    it("resolves per-entity in a mixed grid", () => {
        setType(store, "a", "agent")
        setType(store, "b", "chat")
        expect(store.get(isAgentModeAtomFamily("a"))).toBe(true)
        expect(store.get(isAgentModeAtomFamily("b"))).toBe(false)
    })
})
