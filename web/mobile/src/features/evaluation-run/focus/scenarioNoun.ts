import type {EvaluationRunKind} from "@agenta/entities/evaluationRun"

/** A human run asks people to judge scenarios; every other run shows test cases. */
export const scenarioNoun = (kind: EvaluationRunKind) =>
    kind === "human" ? "Scenario" : "Test case"
