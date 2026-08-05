import {atomWithImmer} from "jotai-immer"

export interface EvalRunDetails2UrlState {
    scenarioId?: string
    view?: string
}

export const pocUrlStateAtom = atomWithImmer<EvalRunDetails2UrlState>({})
