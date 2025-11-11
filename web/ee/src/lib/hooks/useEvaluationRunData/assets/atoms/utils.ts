import {Atom, atom} from "jotai"
import {eagerAtom} from "jotai-eager"

import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"

import {evaluationRunStateAtom} from "./evaluationRunStateAtom"

export const evaluationEvaluatorsAtom = eagerAtom(
    (get) => get(evaluationRunStateAtom).enrichedRun?.evaluators,
) as Atom<EvaluatorDto[]>

export type ScenarioFilter = "all" | "pending" | "unannotated" | "failed"
export const evalScenarioFilterAtom = atom<ScenarioFilter>("all")
