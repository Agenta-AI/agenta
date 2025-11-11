import {EvaluatorCategory} from "./types"

export const EVALUATOR_TABS: {label: string; key: EvaluatorCategory}[] = [
    {label: "Automatic Evaluators", key: "automatic"},
    {label: "Human Evaluators", key: "human"},
]

export const DEFAULT_EVALUATOR_TAB: EvaluatorCategory = "automatic"

export const EVALUATOR_TABLE_STORAGE_PREFIX = "project-evaluators"
