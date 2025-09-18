import {message} from "antd"
import {atomWithMutation} from "jotai-tanstack-query"
import posthog from "posthog-js"

import {queryClient} from "@/oss/lib/api/queryClient"
import {createPublishRevision, createPublishVariant} from "@/oss/services/deployment/api"

export interface PublishRevisionPayload {
    type: "revision"
    revision_id: string
    environment_ref: string
    note?: string
    revision_number?: number
    // Optional metadata for success messaging and analytics
    variantName?: string
    appId?: string
    deploymentType?: "deploy" | "revert" // For different analytics events
}

export interface PublishVariantPayload {
    type: "variant"
    variant_id: string
    revision_id?: string
    environment_name: string
    note?: string
}

export type PublishPayload = PublishRevisionPayload | PublishVariantPayload

export const publishMutationAtom = atomWithMutation<void, PublishPayload>(() => ({
    mutationFn: async (payload) => {
        if (payload.type === "revision") {
            const {type, variantName, appId, ...rest} = payload
            await createPublishRevision(rest)
        } else {
            const {type, ...rest} = payload
            await createPublishVariant(rest)
        }
    },
    onSuccess: (_, payload) => {
        // refresh dependent queries (only environments needed here)
        // Environments drive deployed status badges
        queryClient.invalidateQueries({queryKey: ["environments"]})
        // Ensure deployment history tables refresh
        queryClient.invalidateQueries({queryKey: ["deploymentRevisions"]})

        // Success messaging and analytics (centralized)
        if (payload.type === "revision" && payload.variantName && payload.environment_ref) {
            message.success(`Published ${payload.variantName} to ${payload.environment_ref}`)

            if (payload.appId) {
                const analyticsEvent =
                    payload.deploymentType === "revert" ? "app_deployment_reverted" : "app_deployed"

                posthog?.capture?.(analyticsEvent, {
                    app_id: payload.appId,
                    environment: payload.environment_ref,
                })
            }
        }
    },
}))
