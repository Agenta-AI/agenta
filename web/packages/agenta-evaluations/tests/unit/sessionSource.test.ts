import type {EvaluationScenario} from "@agenta/entities/evaluationScenario"
import {atom, createStore} from "jotai"
import {describe, it, expect} from "vitest"

import {evaluationSessionController as c} from "../../src/state/session"

const scn = (id: string, status?: string): EvaluationScenario =>
    ({id, status: status ?? null}) as EvaluationScenario

describe("session engine — reactive scenario source injection", () => {
    it("reads through an injected source atom and reacts to its updates", () => {
        const store = createStore()
        // Consumer's own scenarios atom (stands in for a molecule selector).
        const sourceAtom = atom<EvaluationScenario[]>([scn("a"), scn("b")])

        store.set(c.actions.openSession, {projectId: "p", runId: "r"})
        store.set(c.actions.setScenarioSource, {scenarios: sourceAtom})

        expect(store.get(c.selectors.scenarioIds())).toEqual(["a", "b"])
        expect(store.get(c.selectors.progress()).total).toBe(2)

        // Update the SOURCE atom — engine reflects it with no re-injection (reactive).
        store.set(sourceAtom, [scn("a"), scn("b"), scn("c")])
        expect(store.get(c.selectors.scenarioIds())).toEqual(["a", "b", "c"])
        expect(store.get(c.selectors.progress()).total).toBe(3)
    })

    it("reactive source takes precedence over the imperative list; closeSession clears both", () => {
        const store = createStore()
        const sourceAtom = atom<EvaluationScenario[]>([scn("x")])

        store.set(c.actions.openSession, {projectId: "p", runId: "r"})
        store.set(c.actions.setScenarios, {scenarios: [scn("imperative")]})
        expect(store.get(c.selectors.scenarioIds())).toEqual(["imperative"])

        store.set(c.actions.setScenarioSource, {scenarios: sourceAtom})
        expect(store.get(c.selectors.scenarioIds())).toEqual(["x"])

        store.set(c.actions.closeSession)
        expect(store.get(c.selectors.scenarioIds())).toEqual([])
        expect(store.get(c.selectors.isActive())).toBe(false)
    })
})
