import type {EvaluationRun} from "@agenta/entities/evaluationRun"
import type {Workflow} from "@agenta/entities/workflow"

import {PreviewTestset, SnakeToCamelCaseKeys, WorkspaceMember} from "@/oss/lib/Types"
import {EvaluatorDto} from "@/oss/services/evaluations/api/evaluatorTypes"

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
export interface EnrichedEvaluationRun extends SnakeToCamelCaseKeys<EvaluationRun> {
    /** All distinct testsets referenced in this run */
    testsets: PreviewTestset[]
    createdBy?: WorkspaceMember
    createdAtTimestamp?: number
    /** All distinct application revisions (variants) referenced */
    variants?: Workflow[]
    evaluators?: EvaluatorDto[]
}
