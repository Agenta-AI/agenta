/**
 * EvaluationScenario schemas.
 *
 * A scenario is one row of an evaluation run (`run → scenarios → results → metrics`).
 * Only the fields the FE relies on are declared (id, run_id, status); everything else
 * passes through (backend mounts payloads with `extra="allow"`).
 */
import {z} from "zod"

import {auditFieldsSchema, timestampFieldsSchema} from "../../shared/utils/zodSchema"

export const evaluationScenarioSchema = z
    .object({
        id: z.string(),
        run_id: z.string().nullable().optional(),
        status: z.string().nullable().optional(),
        interval: z.number().nullable().optional(),
        timestamp: z.string().nullable().optional(),
    })
    .merge(timestampFieldsSchema)
    .merge(auditFieldsSchema)
    .passthrough()
export type EvaluationScenario = z.infer<typeof evaluationScenarioSchema>

/**
 * Multi-scenario query response envelope.
 * `POST /evaluations/scenarios/query` and `PATCH /evaluations/scenarios/`.
 */
export const evaluationScenariosResponseSchema = z.object({
    count: z.number(),
    scenarios: z.array(evaluationScenarioSchema),
})
export type EvaluationScenariosResponse = z.infer<typeof evaluationScenariosResponseSchema>
