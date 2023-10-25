import {atom} from "jotai"
import {Evaluation, EvaluationScenario} from "../Types"

export const evaluationAtom = atom<Evaluation | undefined>(undefined)

export const evaluationScenariosAtom = atom<EvaluationScenario[]>([])
