/**
 * `/account-choices` calls.
 *
 * The routes are not in the generated client yet, so these go through the host's axios. They
 * move to `getAccountChoicesClient()` when the client is regenerated from the package branch.
 */
import {axios, getAgentaApiUrl} from "@agenta/shared/api"

import {safeParseWithLogging} from "../shared"

import {
    accountChoiceResponseSchema,
    accountChoicesResponseSchema,
    itemAccountsResponseSchema,
    type AccountChoice,
    type ItemAccount,
} from "./schema"

const BASE = "/account-choices"

const scoped = (projectId: string) => ({params: {project_id: projectId}})

/** The one account the asker picked: exactly one of the two ids. */
export type AccountPick = {secretId: string} | {gatewayConnectionId: string}

export const upsertAccountChoice = async ({
    projectId,
    workflowId,
    itemKey,
    account,
}: {
    projectId: string
    workflowId: string
    itemKey: string
    account: AccountPick
}): Promise<AccountChoice | null> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}${BASE}/`,
        {
            account_choice: {
                workflow_id: workflowId,
                item_key: itemKey,
                ...("secretId" in account
                    ? {secret_id: account.secretId}
                    : {gateway_connection_id: account.gatewayConnectionId}),
            },
        },
        scoped(projectId),
    )
    const data = safeParseWithLogging(
        accountChoiceResponseSchema,
        response.data,
        "[upsertAccountChoice]",
    )
    return data?.account_choice ?? null
}

/** The asker's choices, filtered by agent, item or the accounts they name. */
export const queryAccountChoices = async ({
    projectId,
    filter,
}: {
    projectId: string
    filter: {workflowId?: string; itemKey?: string; secretIds?: string[]}
}): Promise<AccountChoice[]> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}${BASE}/query`,
        {
            account_choice: {
                workflow_id: filter.workflowId,
                item_key: filter.itemKey,
                secret_ids: filter.secretIds,
            },
        },
        scoped(projectId),
    )
    const data = safeParseWithLogging(
        accountChoicesResponseSchema,
        response.data,
        "[queryAccountChoices]",
    )
    return data?.account_choices ?? []
}

export const deleteAccountChoice = async ({
    projectId,
    accountChoiceId,
}: {
    projectId: string
    accountChoiceId: string
}): Promise<void> => {
    await axios.delete(`${getAgentaApiUrl()}${BASE}/${accountChoiceId}`, scoped(projectId))
}

/**
 * The account each "user" item gets when the asker runs this configuration, saved or not (an
 * item switched to "each person" in the editor). `parameters` has the revision's `parameters`
 * shape.
 */
export const resolveDraftAccountChoices = async ({
    projectId,
    workflowId,
    parameters,
}: {
    projectId: string
    workflowId: string
    parameters: Record<string, unknown>
}): Promise<ItemAccount[]> => {
    const response = await axios.post(
        `${getAgentaApiUrl()}${BASE}/resolve`,
        {workflow_id: workflowId, workflow_revision_ref: null, parameters},
        scoped(projectId),
    )
    const data = safeParseWithLogging(
        itemAccountsResponseSchema,
        response.data,
        "[resolveDraftAccountChoices]",
    )
    return data?.item_accounts ?? []
}
