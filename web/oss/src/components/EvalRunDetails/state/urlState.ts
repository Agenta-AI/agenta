import {atom} from "jotai"
import {atomWithImmer} from "jotai-immer"

import {evalTypeAtom} from "./evalType"

export interface EvalRunUrlState {
    view?:
        | "list"
        | "table"
        | "focus"
        | "results"
        | "overview"
        | "testcases"
        | "prompt"
        | "results"
        | "configuration"
    scenarioId?: string
    compare?: string[] // Array of run IDs to compare against the base run
}

// Holds the subset of query params we care about for EvalRunDetails page
export const urlStateAtom = atomWithImmer<EvalRunUrlState>({})

type HumanEvalViewTypes = "focus" | "list" | "table" | "results"
type AutoEvalViewTypes = "overview" | "testcases" | "prompt"
type OnlineEvalViewTypes = "overview" | "results" | "configuration"

// Derived UI atom: maps the URL state and eval type to a concrete view
export const runViewTypeAtom = atom<HumanEvalViewTypes | AutoEvalViewTypes | OnlineEvalViewTypes>(
    (get) => {
        const evalType = get(evalTypeAtom)
        const view = get(urlStateAtom).view

        const humanViews: HumanEvalViewTypes[] = ["focus", "list", "table", "results"]
        // Put "testcases" first so it becomes the default for auto evaluations
        const autoViews: AutoEvalViewTypes[] = ["testcases", "overview", "prompt"]

        if (evalType === "auto" || evalType === "custom") {
            // default and validation for auto eval
            const v = (view as AutoEvalViewTypes | undefined) ?? autoViews[0]
            return autoViews.includes(v) ? v : autoViews[0]
        }

        if (evalType === "online") {
            const onlineViews: OnlineEvalViewTypes[] = ["results", "overview", "configuration"]
            const v = (view as OnlineEvalViewTypes | undefined) ?? onlineViews[0]
            return onlineViews.includes(v) ? v : onlineViews[0]
        }

        // default and validation for human eval
        const v = (view as HumanEvalViewTypes | undefined) ?? humanViews[0]
        return humanViews.includes(v) ? v : humanViews[0]
    },
)
