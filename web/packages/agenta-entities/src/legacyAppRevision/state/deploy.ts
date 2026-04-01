import {axios, getAgentaApiUrl, queryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {atomWithMutation} from "jotai-tanstack-query"

import {invalidateEnvironmentsListCache} from "../../environment"

import {legacyAppRevisionEntityWithBridgeAtomFamily} from "./store"

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
 * Legacy-compatible publish mutation used by OSS deployment UIs.
 *
 * This keeps existing endpoint contracts while moving deployment mutations
 * into the entities package.
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

        const revisionData = get(legacyAppRevisionEntityWithBridgeAtomFamily(payload.revision_id))
        const applicationId = payload.application_id || revisionData?.appId

        if (!applicationId) {
            throw new Error("No application id available for publishRevision")
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
