import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

import {evalTypeAtom} from "../state/evalType"

export interface EvalRunUrlState {
    view?: "list" | "table" | "focus"
    scenarioId?: string
}

// Holds the subset of query params we care about for EvalRunDetails page
export const urlStateAtom = atomWithImmer<EvalRunUrlState>({})

type HumanEvalViewTypes = "focus" | "list" | "table" | "results"
type AutoEvalViewTypes = "overview" | "test-cases" | "prompt"

// Derived UI atom: maps the URL state and eval type to a concrete view
export const runViewTypeAtom = atom<HumanEvalViewTypes | AutoEvalViewTypes>((get) => {
    const evalType = get(evalTypeAtom)
    const view = get(urlStateAtom).view

    const humanViews: HumanEvalViewTypes[] = ["focus", "list", "table", "results"]
    const autoViews: AutoEvalViewTypes[] = ["overview", "test-cases", "prompt"]

    if (evalType === "auto") {
        // default and validation for auto eval
        const v = (view as AutoEvalViewTypes | undefined) ?? autoViews[0]
        return autoViews.includes(v) ? v : undefined
    }

    // default and validation for human eval
    const v = (view as HumanEvalViewTypes | undefined) ?? humanViews[0]
    return humanViews.includes(v) ? v : "focus"
})
