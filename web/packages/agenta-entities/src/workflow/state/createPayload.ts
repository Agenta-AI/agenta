import {stripAgentaMetadataDeep} from "@agenta/shared/utils"
import type {Getter} from "jotai"

import {flattenEvaluatorConfiguration} from "../../runnable/evaluatorTransforms"
import {syncPromptInputKeysInParameters} from "../../runnable/utils"
import type {WorkflowRoleFlags} from "../api"
import type {Workflow, WorkflowData} from "../core"

import {getFlatSourceData, workflowEntityAtomFamily} from "./store"

export interface EphemeralCreatePayload {
    entity: Workflow
    data: WorkflowData | undefined
    flags: WorkflowRoleFlags | undefined
}

export function prepareCommitParameters(
    entity: Workflow,
    flatParams: Record<string, unknown> | null,
): Record<string, unknown> | undefined {
    const rawParams = stripAgentaMetadataDeep(entity.data?.parameters) as
        | Record<string, unknown>
        | undefined
    if (!rawParams) return undefined
    if (entity.flags?.is_evaluator) {
        return flattenEvaluatorConfiguration(rawParams, flatParams)
    }
    return (
        (syncPromptInputKeysInParameters(rawParams) as Record<string, unknown> | undefined) ??
        rawParams
    )
}

export function prepareCommitSchemas(
    entity: Workflow,
    flatSchemas: WorkflowData["schemas"] | null,
): WorkflowData["schemas"] | undefined {
    const edited = entity.data?.schemas
    if (!entity.flags?.is_evaluator || !edited) return edited
    return {...edited, parameters: flatSchemas?.parameters ?? edited.parameters}
}

export function buildCreatePayloadFromEphemeral(
    get: Getter,
    revisionId: string,
): EphemeralCreatePayload {
    const entity = get(workflowEntityAtomFamily(revisionId))
    if (!entity) throw new Error(`No workflow entity found for ${revisionId}`)

    const flatSource = getFlatSourceData(get, revisionId)
    const flatParams = (flatSource?.data?.parameters as Record<string, unknown> | null) ?? null
    const flatSchemas = flatSource?.data?.schemas ?? null
    const data = entity.data
        ? {
              uri: entity.data.uri,
              parameters: prepareCommitParameters(entity, flatParams),
              schemas: prepareCommitSchemas(entity, flatSchemas),
          }
        : undefined
    const flags = entity.flags
        ? {
              is_application: entity.flags.is_application,
              is_evaluator: entity.flags.is_evaluator,
              is_snippet: entity.flags.is_snippet,
          }
        : undefined

    return {entity, data, flags}
}
