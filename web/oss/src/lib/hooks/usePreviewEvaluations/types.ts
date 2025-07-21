import {EnhancedVariant} from "../../shared/variant/transformer/types"
import {PreviewTestSet, SnakeToCamelCaseKeys, WorkspaceMember} from "../../Types"
import {EvaluatorDto} from "../useEvaluators/types"
/**
 * Interface representing a single evaluation run as returned from the backend API.
 * Contains metadata and structured evaluation logic steps including input,
 * invocation (application), and annotation (evaluation) stages.
 */

export type EvaluationRunDataStep =
    | {
          /** First step: define the test input and optionally the testset variant/revision */
          key: string
          type: "input"
          /** References to testset and optionally its variant/revision */
          references: Record<string, {id: string}>
      }
    | {
          /** Invocation step: connects the application variant to the input */
          key: string
          type: "invocation"
          /** Defines which previous steps this step takes input from */
          inputs: {key: string}[]
          /** References to application, variant, and revision IDs */
          references: Record<string, {id: string}>
      }
    | {
          /** Annotation step: applies an evaluator to the input + invocation results */
          key: string
          type: "annotation"
          /** Usually takes input from both the "input" and "invocation" steps */
          inputs: {key: string}[]
          /** References to evaluator slug and evaluator variant ID */
          references: Record<string, {id: string}>
      }

export type IEvaluationRunDataStep = SnakeToCamelCaseKeys<EvaluationRunDataStep>
export interface EvaluationRun {
    /** Unique identifier for the evaluation run */
    id: string
    /** Display name for the run */
    name: string
    /** Optional description text for the run */
    description: string
    /** ISO timestamp of when the run was created */
    created_at: string
    /** ID of the user who created the run */
    created_by_id: string
    /** Optional metadata object (arbitrary key-value pairs) */
    meta: Record<string, any>
    /** Flags associated with the run (internal use) */
    flags: Record<string, any>
    /** Current status of the run (e.g., "pending", "completed") */
    status: string
    data: {
        /** Array of evaluation steps that define execution flow */
        steps: EvaluationRunDataStep[]
        /** Mappings define how to extract values from steps for display or evaluation */
        mappings: {
            /** Type of the mapping, determines what the value represents */
            kind: "input" | "ground_truth" | "application" | "evaluator"
            /** Display name for the mapped value */
            name: string
            /** Path reference to the data inside a step */
            step: {
                /** The step key this mapping belongs to */
                key: string
                /** Path within the step data (e.g., 'country' or 'data.outputs.metric') */
                path: string
            }
        }[]
    }
}

export interface EnrichedEvaluationRun extends SnakeToCamelCaseKeys<EvaluationRun> {
    /** All distinct testsets referenced in this run */
    testsets: PreviewTestSet[]
    createdBy?: WorkspaceMember
    createdAtTimestamp?: number
    /** All distinct application revisions (variants) referenced */
    variants?: EnhancedVariant[]
    evaluators?: EvaluatorDto[]
}
