import {Atom, atom} from "jotai"
import {eagerAtom} from "jotai-eager"

import {EvaluatorDto} from "../../../useEvaluators/types"

import {evaluationRunStateAtom} from "./evaluationRunStateAtom"

// UI atom to track current scenario view type ("focus" or "table")
export const runViewTypeAtom = atom<"focus" | "list" | "table" | "results">("focus")

export const evaluationEvaluatorsAtom = eagerAtom(
    (get) => get(evaluationRunStateAtom).enrichedRun?.evaluators,
) as Atom<EvaluatorDto[]>

export type ScenarioFilter = "all" | "pending" | "unannotated" | "failed"
export const evalScenarioFilterAtom = atom<ScenarioFilter>("all")
