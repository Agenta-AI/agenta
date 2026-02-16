import {getDefaultStore} from "jotai"

import {getAgentaApiUrl} from "@/oss/lib/helpers/api"
import {EnrichedEvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"
import {transformToRequestBody} from "@/oss/lib/shared/variant/transformer/transformToRequestBody"
import type {WorkspaceMember} from "@/oss/lib/Types"
import {getJWT} from "@/oss/services/api"
import {currentAppAtom} from "@/oss/state/app"
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {transformedPromptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {requestSchemaMetaAtomFamily} from "@/oss/state/newPlayground/core/requestSchemaMeta"
import {getOrgValues} from "@/oss/state/org"
import {getProjectValues} from "@/oss/state/project"
import {appUriInfoAtom, appSchemaAtom} from "@/oss/state/variant/atoms/fetcher"

import {RunIndex} from "../buildRunIndex"

import {EvalWorkerContextBase, WorkerAuthContext} from "./types"

/**
 * Build the evaluation-specific context for a worker fetch based on the current jotai store state.
 */
export const buildEvalWorkerContext = (params: {
    runId: string
    evaluation: EnrichedEvaluationRun
    runIndex: RunIndex
}): EvalWorkerContextBase => {
    const {selectedOrg} = getOrgValues()
    const members = (selectedOrg?.default_workspace?.members as WorkspaceMember[]) || []

    const store = getDefaultStore()
    const appType = store.get(currentAppAtom)?.app_type

    const chatVariantIds: string[] = (params.evaluation?.variants || [])
        .filter(Boolean)
        .map((v: any) => {
            const routePath = store.get(appUriInfoAtom)?.routePath
            const meta = store.get(requestSchemaMetaAtomFamily({variant: v as any, routePath}))
            return meta?.hasMessages ? (v as any).id : undefined
        })
        .filter(Boolean) as string[]

    // Build a stable parameters map per revision using transformedPromptsAtomFamily(useStableParams)
    const parametersByRevisionId: Record<string, any> = {}
    const revisionIds = (params.evaluation?.variants || [])
        .map((v: any) => v?.id)
        .filter(Boolean) as string[]
    for (const rid of revisionIds) {
        const stable = store.get(
            transformedPromptsAtomFamily({revisionId: rid, useStableParams: true}),
        )
        if (stable) parametersByRevisionId[rid] = stable
    }

    return {
        runId: params.runId,
        mappings: params.evaluation?.data?.mappings ?? [],
        members,
        appType,
        evaluators: params.evaluation?.evaluators || [],
        testsets: params.evaluation?.testsets || [],
        variants: (params.evaluation?.variants || []).map((v) => {
            try {
                const routePath = store.get(appUriInfoAtom)?.routePath
                const spec = store.get(appSchemaAtom)
                const meta = store.get(requestSchemaMetaAtomFamily({variant: v as any, routePath}))
                // Custom workflow detection:
                // - no messages container, and no `inputs` container => top-level custom inputs
                // Completion apps usually have `inputs`; treat them as non-custom.
                const hasInputsContainer = Array.isArray(meta?.inputKeys)
                    ? meta.inputKeys.includes("inputs")
                    : false
                const isCustom = Boolean(!meta?.hasMessages && !hasInputsContainer)
                const appType = (store.get(currentAppContextAtom)?.appType as any) || undefined
                const rid = (v as any)?.id as string | undefined
                const stableOptional = rid
                    ? store.get(
                          transformedPromptsAtomFamily({
                              revisionId: rid,
                              useStableParams: true,
                          }),
                      )
                    : undefined
                return {
                    ...v,
                    isCustom,
                    // precompute optionalParameters to avoid metadata lookup in worker
                    optionalParameters:
                        stableOptional ||
                        transformToRequestBody({
                            variant: v,
                            isChat: meta?.hasMessages,
                            isCustom,
                            appType,
                            spec: spec as any,
                            routePath,
                        }),
                }
            } catch {
                return {
                    ...v,
                    optionalParameters: transformToRequestBody({
                        variant: v,
                        appType:
                            ((() => {
                                try {
                                    return store.get(currentAppContextAtom)?.appType as any
                                } catch {
                                    return undefined
                                }
                            })() as any) || undefined,
                        spec: ((): any => {
                            try {
                                return store.get(appSchemaAtom)
                            } catch {
                                return undefined
                            }
                        })(),
                        routePath: ((): any => {
                            try {
                                return store.get(appUriInfoAtom)?.routePath
                            } catch {
                                return undefined
                            }
                        })(),
                    }),
                }
            }
        }),
        runIndex: params.runIndex,
        chatVariantIds,
        uriObject: store.get(appUriInfoAtom) || undefined,
        parametersByRevisionId,
    }
}

/**
 * Resolve JWT, apiUrl and projectId in a single place.
 */
export const buildAuthContext = async (): Promise<WorkerAuthContext> => {
    const jwt = (await getJWT()) || ""
    const apiUrl = getAgentaApiUrl()
    const {projectId} = getProjectValues() ?? ""
    return {jwt, apiUrl, projectId}
}
