/**
 * Publish Mutation — Entity-agnostic deployment atom
 *
 * Publishes a revision (or legacy variant) to an environment.
 * Uses the router app_id or explicit application_id in the payload
 * rather than entity-type-specific molecule lookups.
 */

import {axios, getAgentaApiUrl, queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atomWithMutation} from "jotai-tanstack-query"

import {invalidateEnvironmentsListCache} from "../environment"

export interface PublishRevisionPayload {
    type: "revision"
    revision_id: string
    environment_ref: string
    note?: string
    revision_number?: number
    application_id?: string
}

export interface PublishVariantPayload {
    type: "variant"
    variant_id: string
    revision_id?: string
    environment_name: string
    note?: string
}

export type PublishPayload = PublishRevisionPayload | PublishVariantPayload

/**
 * Entity-agnostic publish mutation used by deployment UIs.
 *
 * For "revision" payloads, `application_id` MUST be provided in the payload.
 * For "variant" payloads, the legacy `/environments/deploy` endpoint is used.
 */
export const publishMutationAtom = atomWithMutation<void, PublishPayload>((get) => ({
    mutationFn: async (payload) => {
        const projectId = get(projectIdAtom)
        if (!projectId) {
            throw new Error("No project ID available for publish")
        }

        if (payload.type === "variant") {
            const {note, ...rest} = payload
            await axios.post(
                `${getAgentaApiUrl()}/environments/deploy`,
                {
                    ...rest,
                    commit_message: note,
                },
                {params: {project_id: projectId}},
            )
            return
        }

        const applicationId = payload.application_id

        if (!applicationId) {
            throw new Error(
                "No application_id provided in publish payload. " +
                    "Pass application_id explicitly for entity-agnostic publishing.",
            )
        }

        await axios.post(
            `${getAgentaApiUrl()}/variants/configs/deploy`,
            {
                application_ref: {
                    id: applicationId,
                    version: null,
                    slug: null,
                },
                variant_ref: {
                    id: payload.revision_id,
                    version: payload.revision_number || null,
                    slug: null,
                },
                environment_ref: {
                    slug: payload.environment_ref,
                    version: null,
                    id: null,
                    commit_message: payload.note || null,
                },
            },
            {params: {project_id: projectId}},
        )
    },
    onSuccess: async () => {
        queryClient.invalidateQueries({queryKey: ["environments"]})
        queryClient.invalidateQueries({queryKey: ["environments-list"], exact: false})
        queryClient.invalidateQueries({queryKey: ["environment"], exact: false})
        invalidateEnvironmentsListCache()
        queryClient.invalidateQueries({queryKey: ["deploymentRevisions"]})
    },
}))
