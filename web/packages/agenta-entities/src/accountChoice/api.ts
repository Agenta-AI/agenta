/**
 * `/account-choices` calls, through the generated client. Answers are checked with the zod
 * schemas before the screens read them.
 */
import {getAccountChoicesClient} from "@agenta/sdk/resources"

import {safeParseWithLogging} from "../shared"

import {
    accountChoiceResponseSchema,
    accountChoicesResponseSchema,
    itemAccountsResponseSchema,
    type AccountChoice,
    type ItemAccount,
} from "./schema"

const projectScopedRequest = (projectId: string) => ({queryParams: {project_id: projectId}})

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
    const response = await getAccountChoicesClient().upsertAccountChoice(
        {
            account_choice: {
                workflow_id: workflowId,
                item_key: itemKey,
                ...("secretId" in account
                    ? {secret_id: account.secretId}
                    : {gateway_connection_id: account.gatewayConnectionId}),
            },
        },
        projectScopedRequest(projectId),
    )
    const data = safeParseWithLogging(
        accountChoiceResponseSchema,
        response,
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
    const response = await getAccountChoicesClient().queryAccountChoices(
        {
            account_choice: {
                workflow_id: filter.workflowId,
                item_key: filter.itemKey,
                secret_ids: filter.secretIds,
            },
        },
        projectScopedRequest(projectId),
    )
    const data = safeParseWithLogging(
        accountChoicesResponseSchema,
        response,
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
    await getAccountChoicesClient().deleteAccountChoice(
        {account_choice_id: accountChoiceId},
        projectScopedRequest(projectId),
    )
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
    const response = await getAccountChoicesClient().resolveAccountChoices(
        {workflow_id: workflowId, parameters},
        projectScopedRequest(projectId),
    )
    const data = safeParseWithLogging(
        itemAccountsResponseSchema,
        response,
        "[resolveDraftAccountChoices]",
    )
    return data?.item_accounts ?? []
}
