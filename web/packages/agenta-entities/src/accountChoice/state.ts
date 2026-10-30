/**
 * Account choice queries: the "When you run it" line of one agent, and the "Used by" line of the
 * asker's secrets. Both are reads; a write calls `invalidateAccountChoices`.
 */
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom} from "@agenta/shared/state"
import {isValidUUID} from "@agenta/shared/utils"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {invalidateAgentRequirements} from "../workflow/state/agentRequirements"

import {queryAccountChoices, resolveAccountChoices} from "./api"
import type {AccountChoice, ItemAccount} from "./schema"

const ACCOUNT_CHOICES_KEY = ["account-choices"] as const

/** One saved revision of one agent, as `workflowId:revisionId`. */
export const itemAccountsFamilyKey = (workflowId: string, revisionId: string) =>
    `${workflowId}:${revisionId}`

/** The account each "user" item gets when the asker runs this revision. Idle for a draft. */
export const itemAccountsQueryAtomFamily = atomFamily((key: string) =>
    atomWithQuery<ItemAccount[]>((get) => {
        const projectId = get(projectIdAtom)
        const [workflowId = "", revisionId = ""] = key.split(":")
        return {
            queryKey: [...ACCOUNT_CHOICES_KEY, "resolve", projectId, workflowId, revisionId],
            queryFn: () =>
                resolveAccountChoices({projectId: projectId as string, workflowId, revisionId}),
            enabled: !!projectId && isValidUUID(workflowId) && isValidUUID(revisionId),
            staleTime: 30_000,
        }
    }),
)

/** The asker's choices that name these secrets, keyed by the sorted ids joined with commas. */
export const secretChoicesQueryAtomFamily = atomFamily((secretIdsKey: string) =>
    atomWithQuery<AccountChoice[]>((get) => {
        const projectId = get(projectIdAtom)
        const secretIds = secretIdsKey ? secretIdsKey.split(",") : []
        return {
            queryKey: [...ACCOUNT_CHOICES_KEY, "by-secrets", projectId, secretIdsKey],
            queryFn: () =>
                queryAccountChoices({projectId: projectId as string, filter: {secretIds}}),
            enabled: !!projectId && secretIds.length > 0,
            staleTime: 30_000,
        }
    }),
)

/** Ask every account choice read again, after a choice, a default or a sign-in changed. */
export const invalidateAccountChoices = (): Promise<void> =>
    getHostQueryClient().invalidateQueries({queryKey: [...ACCOUNT_CHOICES_KEY]})

/**
 * A person's account was added, changed or removed: what each agent gets when they run it, and
 * what Needs setup asks for, may differ. Every write of an account calls this one place.
 */
export const invalidatePersonalAccountReads = async (): Promise<void> => {
    await Promise.all([invalidateAccountChoices(), invalidateAgentRequirements()])
}
