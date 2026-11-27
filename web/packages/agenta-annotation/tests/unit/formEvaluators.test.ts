/**
 * The run's annotation form: human steps only, plus the evaluators a host adds or hides
 * (`setFormEvaluators`). A hidden evaluator keeps its edits in the draft, but they are not
 * counted or saved; showing it again brings them back.
 */
import {getDefaultStore} from "jotai/vanilla"
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"

const steps = vi.hoisted(() => [
    {
        key: "tone",
        type: "annotation",
        origin: "human",
        references: {
            evaluator: {id: "wf-tone", slug: "tone"},
            evaluator_revision: {id: "rev-tone"},
        },
    },
    {
        key: "judge",
        type: "annotation",
        origin: "auto",
        references: {
            evaluator: {id: "wf-judge", slug: "judge"},
            evaluator_revision: {id: "rev-judge"},
        },
    },
])

vi.mock("@agenta/entities/evaluationRun", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@agenta/entities/evaluationRun")>()
    const {atom} = await import("jotai")
    const stepsAtom = atom(steps)
    const human = atom((get) => get(stepsAtom).filter((step) => step.origin === "human"))
    return {
        ...actual,
        evaluationRunMolecule: {
            ...actual.evaluationRunMolecule,
            selectors: {
                ...actual.evaluationRunMolecule.selectors,
                annotationSteps: () => stepsAtom,
                humanAnnotationSteps: () => human,
            },
        },
    }
})

vi.mock("@agenta/entities/workflow", async () => {
    const {atom} = await import("jotai")
    const evaluator = (slug: string) => ({
        id: `rev-${slug}`,
        slug,
        name: slug,
        workflow_id: `wf-${slug}`,
        data: {schemas: {outputs: {properties: {friendly: {type: "boolean"}}}}},
    })
    const query = (id: string | null) =>
        atom({data: id ? evaluator(id.replace(/^(rev|wf)-/, "")) : null, isPending: false})
    return {
        resolveOutputSchema: (data: {schemas?: {outputs?: unknown}}) => data?.schemas?.outputs,
        workflowQueryAtomFamily: query,
        workflowLatestRevisionQueryAtomFamily: query,
        workflowDetailQueryAtomFamily: query,
        workflowMolecule: {selectors: {data: () => atom(null), query: () => atom({})}},
    }
})

import {annotationFormController, annotationSessionController} from "../../src"

const store = getDefaultStore()
const SCENARIO = "scenario-1"
const slugs = () =>
    store.get(annotationFormController.selectors.evaluators(SCENARIO)).map((e) => e.slug)
const count = () => store.get(annotationFormController.selectors.pendingChangeCount(SCENARIO))

beforeEach(() => {
    store.set(annotationSessionController.actions.openRun, {runId: "run-1"})
})
afterEach(() => {
    store.set(annotationFormController.actions.resetEdits, SCENARIO)
    store.set(annotationSessionController.actions.closeSession)
})

describe("the run's form evaluators", () => {
    it("lists the human steps only, then an added evaluator", () => {
        expect(slugs()).toEqual(["tone"])
        store.set(annotationSessionController.actions.setFormEvaluators, {
            added: [{workflowId: "wf-clarity", revisionId: "rev-clarity", slug: "clarity"}],
            hidden: [],
        })
        expect(slugs()).toEqual(["tone", "clarity"])
    })

    it("does not list an added evaluator twice when the run has it or it is added twice", () => {
        const clarity = {workflowId: "wf-clarity", revisionId: "rev-clarity", slug: "clarity"}
        store.set(annotationSessionController.actions.setFormEvaluators, {
            added: [
                {workflowId: "wf-tone", revisionId: "rev-tone", slug: "tone"},
                clarity,
                clarity,
            ],
            hidden: [],
        })
        expect(slugs()).toEqual(["tone", "clarity"])
    })

    it("keeps a hidden evaluator's edits in the draft, out of the count and the save", () => {
        store.set(annotationFormController.actions.updateMetric, {
            scenarioId: SCENARIO,
            slug: "tone",
            fieldKey: "friendly",
            value: true,
        })
        expect(count()).toBe(1)
        expect(store.get(annotationFormController.selectors.hasPendingChanges(SCENARIO))).toBe(true)

        store.set(annotationSessionController.actions.setFormEvaluators, {
            added: [],
            hidden: ["tone"],
        })
        expect(slugs()).toEqual([])
        expect(count()).toBe(0)
        expect(store.get(annotationFormController.selectors.hasPendingChanges(SCENARIO))).toBe(
            false,
        )
        expect(store.get(annotationFormController.selectors.effectiveMetrics(SCENARIO))).toEqual({})

        store.set(annotationSessionController.actions.setFormEvaluators, null)
        expect(count()).toBe(1)
        expect(
            store.get(annotationFormController.selectors.effectiveMetrics(SCENARIO)).tone?.friendly
                ?.value,
        ).toBe(true)
    })

    it("keeps an added then removed evaluator's edits in the draft, out of the count", () => {
        const clarity = {workflowId: "wf-clarity", revisionId: "rev-clarity", slug: "clarity"}
        store.set(annotationSessionController.actions.setFormEvaluators, {
            added: [clarity],
            hidden: [],
        })
        store.set(annotationFormController.actions.updateMetric, {
            scenarioId: SCENARIO,
            slug: "clarity",
            fieldKey: "friendly",
            value: true,
        })
        expect(count()).toBe(1)

        store.set(annotationSessionController.actions.setFormEvaluators, {added: [], hidden: []})
        expect(slugs()).toEqual(["tone"])
        expect(count()).toBe(0)
        expect(store.get(annotationFormController.selectors.hasFilledMetrics(SCENARIO))).toBe(false)
        expect(
            store.get(annotationFormController.selectors.effectiveMetrics(SCENARIO)).clarity,
        ).toBeUndefined()

        store.set(annotationSessionController.actions.setFormEvaluators, {
            added: [clarity],
            hidden: [],
        })
        expect(count()).toBe(1)
    })

    it("counts each changed field, and not a field set back to its saved value", () => {
        store.set(annotationSessionController.actions.setFormEvaluators, {
            added: [{workflowId: "wf-clarity", revisionId: "rev-clarity", slug: "clarity"}],
            hidden: [],
        })
        const edit = (slug: string, value: unknown) =>
            store.set(annotationFormController.actions.updateMetric, {
                scenarioId: SCENARIO,
                slug,
                fieldKey: "friendly",
                value,
            })
        edit("tone", true)
        edit("clarity", false)
        expect(count()).toBe(2)
        edit("clarity", null)
        expect(count()).toBe(1)
    })

    it("is cleared by closeSession and ignored outside a run", () => {
        store.set(annotationSessionController.actions.setFormEvaluators, {
            added: [],
            hidden: ["tone"],
        })
        store.set(annotationSessionController.actions.closeSession)
        expect(store.get(annotationSessionController.selectors.formEvaluators())).toBeNull()
        store.set(annotationSessionController.actions.setFormEvaluators, {
            added: [],
            hidden: ["tone"],
        })
        expect(store.get(annotationSessionController.selectors.formEvaluators())).toBeNull()
    })
})
