import {useCallback} from "react"

import {environmentsListQueryAtomFamily} from "@agenta/entities/environment"
import {publishMutationAtom} from "@agenta/entities/runnable"
import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"

export interface DeployTarget {
    /** The app revision to put in the environment. */
    revisionId: string
    revisionVersion: number | null
    appId: string
    appSlug: string | null
    variantId: string | null
    variantSlug: string | null
}

const usePublish = () => {
    // The publish mutation reads the environments list from the cache. Subscribing keeps that
    // list loaded while a deploy dialog is open.
    useAtomValue(environmentsListQueryAtomFamily(false))
    return useAtomValue(publishMutationAtom).mutateAsync
}

const toPayload = (target: DeployTarget, environmentSlug: string, note: string) => ({
    revisionId: target.revisionId,
    environmentSlug,
    // An empty note stays empty, as in /w. Undefined makes the package write `Deploy <app key>`.
    note: note.trim(),
    applicationId: target.appId,
    applicationSlug: target.appSlug ?? undefined,
    workflowVariantId: target.variantId ?? undefined,
    variantSlug: target.variantSlug ?? undefined,
    revisionVersion: target.revisionVersion ?? undefined,
})

/**
 * Deploy a revision to an environment, by the environment's slug. Resolves `true` when it worked.
 * On failure it tells the reader in plain words and logs the cause.
 */
export const useDeployRevision = () => {
    const publish = usePublish()
    return useCallback(
        async (args: {
            target: DeployTarget
            environmentSlug: string
            /** Shown in the success toast. */
            successText: string
            note: string
        }): Promise<boolean> => {
            try {
                await publish(toPayload(args.target, args.environmentSlug, args.note))
                message.success(args.successText)
                return true
            } catch (error) {
                console.error("Deploy failed", error)
                message.error("Couldn't deploy this revision")
                return false
            }
        },
        [publish],
    )
}

/**
 * Deploy the revision a history row deployed back to its environment. Resolves `true` when it
 * worked.
 */
export const useRevertDeployment = () => {
    const publish = usePublish()
    return useCallback(
        async (args: {
            target: DeployTarget
            environmentSlug: string
            environmentName: string
            note: string
        }): Promise<boolean> => {
            try {
                await publish(toPayload(args.target, args.environmentSlug, args.note))
                message.success(`Reverted in ${args.environmentName} successfully`)
                return true
            } catch (error) {
                console.error("Revert failed", error)
                message.error("Couldn't revert this deployment")
                return false
            }
        },
        [publish],
    )
}
