/**
 * Unit tests for `isAgentModeAtomFamily` — the per-entity agent-mode flag the
 * playground's third generation arm branches on.
 *
 * Contract under test:
 * - true when the entity's `workflowType === "agent"` (the WP-6 signal)
 * - disjoint from chat/completion: a chat- or completion-type entity is NOT
 *   agent (guards the both-true hazard the `ExecutionItems` ternary relies on)
 * - per-entity: two entities in the same store resolve independently (mixed
 *   comparison grids must not misroute)
 * - schema-marker detection: the config schema carrying an `agent_config`
 *   block (`x-ag-type-ref`/`x-ag-type`) detects as agent even when the harness/
 *   sandbox values live nested (not at the top level of `configuration`) — this
 *   is the signal the left-panel AgentConfigControl already dispatches on
 * - heuristic fallback: until WP-6, a stored config carrying top-level
 *   `harness`/`sandbox` detects as agent even when workflowType hasn't resolved
 *   to "agent" yet
 *
 * The workflow molecule is mocked with writable atoms for `workflowType`,
 * `configuration`, and `parametersSchema`, mirroring modeOverride.test.ts.
 */
import {createStore, type PrimitiveAtom} from "jotai"
import {describe, expect, it, beforeEach, vi} from "vitest"

vi.mock("@agenta/entities/workflow", async (importOriginal) => {
    const actual = (await importOriginal()) as any
    const {atom} = await import("jotai")
    const typeAtoms = new Map<string, unknown>()
    const configAtoms = new Map<string, unknown>()
    const schemaAtoms = new Map<string, unknown>()
    const typeFor = (id: string) => {
        if (!typeAtoms.has(id)) typeAtoms.set(id, atom<string>("completion"))
        return typeAtoms.get(id)
    }
    const configFor = (id: string) => {
        if (!configAtoms.has(id)) configAtoms.set(id, atom<Record<string, unknown> | null>(null))
        return configAtoms.get(id)
    }
    const schemaFor = (id: string) => {
        if (!schemaAtoms.has(id)) schemaAtoms.set(id, atom<Record<string, unknown> | null>(null))
        return schemaAtoms.get(id)
    }
    // Keep the rest of the module real (snapshot adapters, etc.); swap only the
    // selectors this atom reads.
    return {
        ...actual,
        workflowMolecule: {
            ...actual.workflowMolecule,
            selectors: {
                ...actual.workflowMolecule.selectors,
                workflowType: typeFor,
                configuration: configFor,
                parametersSchema: schemaFor,
            },
        },
    }
})

import {workflowMolecule} from "@agenta/entities/workflow"

import {isAgentModeAtomFamily} from "../../src/state/execution/selectors"

const setType = (store: ReturnType<typeof createStore>, id: string, type: string) =>
    store.set(workflowMolecule.selectors.workflowType(id) as PrimitiveAtom<string>, type)

const setConfig = (
    store: ReturnType<typeof createStore>,
    id: string,
    config: Record<string, unknown> | null,
) =>
    store.set(
        workflowMolecule.selectors.configuration(id) as PrimitiveAtom<Record<
            string,
            unknown
        > | null>,
        config,
    )

const setSchema = (
    store: ReturnType<typeof createStore>,
    id: string,
    schema: Record<string, unknown> | null,
) =>
    store.set(
        workflowMolecule.selectors.parametersSchema(id) as PrimitiveAtom<Record<
            string,
            unknown
        > | null>,
        schema,
    )

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

    it("resolves per-entity in a mixed grid", () => {
        setType(store, "a", "agent")
        setType(store, "b", "chat")
        expect(store.get(isAgentModeAtomFamily("a"))).toBe(true)
        expect(store.get(isAgentModeAtomFamily("b"))).toBe(false)
    })

    it("schema marker: an agent_config property detects as agent even when harness/sandbox are nested", () => {
        // Real-world shape: backend hasn't set is_agent (rides as `custom`), and
        // harness/sandbox live INSIDE the agent_config block — so the top-level
        // configuration heuristic misses. The schema marker is what saves it.
        setType(store, "ag", "custom")
        setConfig(store, "ag", {agent_config: {harness: "pi_core", sandbox: "local"}})
        setSchema(store, "ag", {
            type: "object",
            properties: {
                agent_config: {"x-ag-type-ref": "agent_config", type: "object"},
            },
        })
        expect(store.get(isAgentModeAtomFamily("ag"))).toBe(true)
    })

    it("schema marker: x-ag-type at the schema root detects as agent", () => {
        setType(store, "root", "custom")
        setSchema(store, "root", {"x-ag-type": "agent_config", type: "object"})
        expect(store.get(isAgentModeAtomFamily("root"))).toBe(true)
    })

    it("schema marker: a non-agent schema does not false-positive", () => {
        setType(store, "noag", "completion")
        setSchema(store, "noag", {
            type: "object",
            properties: {temperature: {type: "number"}},
        })
        expect(store.get(isAgentModeAtomFamily("noag"))).toBe(false)
    })

    it("heuristic: a config carrying harness/sandbox detects as agent", () => {
        setType(store, "h", "custom") // not yet flagged agent
        setConfig(store, "h", {harness: "pi_core", sandbox: "local"})
        expect(store.get(isAgentModeAtomFamily("h"))).toBe(true)
    })

    it("heuristic does not false-positive without harness/sandbox", () => {
        setType(store, "plain", "completion")
        setConfig(store, "plain", {temperature: 0.7})
        expect(store.get(isAgentModeAtomFamily("plain"))).toBe(false)
    })
})
