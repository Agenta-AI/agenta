import {atom} from "jotai"

export type EvaluationPanelKey =
    | "appPanel"
    | "variantPanel"
    | "testsetPanel"
    | "evaluatorPanel"
    | "advancedSettingsPanel"

// Global atom to control the active tab in New Evaluation modal
export const activeEvaluationPanelAtom = atom<EvaluationPanelKey | null>("appPanel")
