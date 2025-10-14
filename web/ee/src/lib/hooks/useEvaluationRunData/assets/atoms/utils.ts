import deepEqual from "fast-deep-equal"
import {Atom, atom} from "jotai"
import {atomFamily} from "jotai/utils"

import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"

import {evaluationRunStateFamily} from "./runScopedAtoms"

type HumanEvalViewTypes = "focus" | "list" | "table" | "results"
type AutoEvalViewTypes = "overview" | "test-cases" | "prompt"

// UI atom to track current scenario view type ("focus" or "table")
// export const runViewTypeAtom = atom<HumanEvalViewTypes | AutoEvalViewTypes>("focus")

export const evaluationEvaluatorsFamily = atomFamily(
    (runId: string) =>
        atom((get) => get(evaluationRunStateFamily(runId)).enrichedRun?.evaluators) as Atom<
            EvaluatorDto[]
        >,
    deepEqual,
)

export type ScenarioFilter = "all" | "pending" | "unannotated" | "failed"
export const evalScenarioFilterAtom = atom<ScenarioFilter>("all")
