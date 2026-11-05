import type {EvaluationRunKind} from "@agenta/entities/evaluationRun"

/** A human run asks people to judge scenarios, a live run reads traces, the others test cases. */
export const scenarioNoun = (kind: EvaluationRunKind) =>
    kind === "human" ? "Scenario" : kind === "online" ? "Trace" : "Test case"
