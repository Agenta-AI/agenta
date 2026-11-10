/**
 * Account choice queries: the "When you run it" line of one agent, and the "Used by" line of the
 * asker's secrets. Both are reads; an account write calls `invalidatePersonalAccountReads`.
 */
import {getHostQueryClient} from "@agenta/shared/api"
import {projectIdAtom, userAtom} from "@agenta/shared/state"
import {isValidUUID} from "@agenta/shared/utils"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"

import {invalidateAgentRequirements} from "../workflow/state/agentRequirements"

import {queryAccountChoices, resolveDraftAccountChoices} from "./api"
import {userItemsParameters} from "./items"
import type {AccountChoice, ItemAccount} from "./schema"

const ACCOUNT_CHOICES_KEY = ["account-choices"] as const

/**
 * The key of {@link draftItemAccountsQueryAtomFamily}: the agent and its "user" items only, so an
 * edit elsewhere in the configuration keeps the same key. Empty when the agent has none.
 */
export const draftItemAccountsFamilyKey = (workflowId: string, agent: unknown): string => {
    const parameters = userItemsParameters(agent)
    return parameters && isValidUUID(workflowId) ? JSON.stringify({workflowId, parameters}) : ""
}

/**
 * The account each "user" item of the configuration on screen gets when the asker runs it, saved
 * or not. One query per agent and set of "user" items, so the drawers of one agent share it. The
 * answer names the asker's own accounts, so it is cached per person.
 */
export const draftItemAccountsQueryAtomFamily = atomFamily((key: string) =>
    atomWithQuery<ItemAccount[]>((get) => {
        const projectId = get(projectIdAtom)
        const userId = get(userAtom)?.id ?? null
        const {workflowId = "", parameters = null} = key
            ? (JSON.parse(key) as {workflowId?: string; parameters?: Record<string, unknown>})
            : {}
        return {
            queryKey: [...ACCOUNT_CHOICES_KEY, "resolve-draft", userId, projectId, key],
            queryFn: () =>
                resolveDraftAccountChoices({
                    projectId: projectId as string,
                    workflowId,
                    parameters: parameters ?? {},
                }),
            enabled: !!projectId && !!userId && !!parameters,
            staleTime: 30_000,
        }
    }),
)

/**
 * The asker's choices that name these secrets, keyed by the sorted ids joined with commas. The
 * answer is the asker's own, so it is cached per person.
 */
export const secretChoicesQueryAtomFamily = atomFamily((secretIdsKey: string) =>
    atomWithQuery<AccountChoice[]>((get) => {
        const projectId = get(projectIdAtom)
        const userId = get(userAtom)?.id ?? null
        const secretIds = secretIdsKey ? secretIdsKey.split(",") : []
        return {
            queryKey: [...ACCOUNT_CHOICES_KEY, "by-secrets", userId, projectId, secretIdsKey],
            queryFn: () =>
                queryAccountChoices({projectId: projectId as string, filter: {secretIds}}),
            enabled: !!projectId && !!userId && secretIds.length > 0,
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
