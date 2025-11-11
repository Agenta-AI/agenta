import {atom} from "jotai"

// This atom used for interacting with the focus drawer
// This is only used in auto evaluation as for now
export const focusScenarioAtom = atom<string | null>(null)
