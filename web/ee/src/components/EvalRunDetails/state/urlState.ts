import {atom} from "jotai"

export interface EvalRunUrlState {
    view?: "list" | "table" | "focus"
    scenarioId?: string
}

// Holds the subset of query params we care about for EvalRunDetails page
export const urlStateAtom = atom<EvalRunUrlState>({})

// Write-only helper: merge partial state
export const setUrlStateAtom = atom(null, (get, set, update: Partial<EvalRunUrlState>) => {
    set(urlStateAtom, {...get(urlStateAtom), ...update})
})
