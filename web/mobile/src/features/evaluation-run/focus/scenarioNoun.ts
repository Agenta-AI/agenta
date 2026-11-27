import type {EvaluationRunKind} from "@agenta/entities/evaluationRun"

/** A human run asks people to judge scenarios, a live run reads traces, the others test cases. */
export const scenarioNoun = (kind: EvaluationRunKind) =>
    kind === "human" ? "Scenario" : kind === "online" ? "Trace" : "Test case"

/** The row word of a run kind as the part of a catalog key: `sortNoteTestCase`, `sortNoteTrace`. */
export type RowNounKey = "TestCase" | "Scenario" | "Trace"

/**
 * The row word of a run kind for a translated sentence. `scenarioNoun` is one English word; a
 * sentence with a count needs one catalog key per row word, each with its plural forms.
 */
export const rowNounKey = (kind: EvaluationRunKind): RowNounKey =>
    kind === "human" ? "Scenario" : kind === "online" ? "Trace" : "TestCase"
