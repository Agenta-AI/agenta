/** The rules of an integration's account part (F10), pure so the tests and the view share them. */
import {USER_ACCOUNT_SOURCE, type ItemAccount} from "@agenta/entities/accountChoice"
import {isConnectionDefault, type ToolConnection} from "@agenta/entities/gatewayTool"
import type {PersonalAccountsAccess} from "@agenta/entities/secret"

import type {GatewayConnectionAccount, ParsedGatewayConnection} from "../../toolUtils"

/** The "Your account" value that follows the viewer's default account. */
export const USE_MY_DEFAULT = "default"

/**
 * The switch shows while personal accounts are on. With them off (or unreadable) only "Shared
 * account" shows, unless the item was saved with each person's own account: the saved value
 * stays visible.
 */
export const showAccountSwitch = (
    access: PersonalAccountsAccess,
    entry: Pick<ParsedGatewayConnection, "accountSource">,
): boolean => access === "on" || entry.accountSource === USER_ACCOUNT_SOURCE

/** "Your account" reads the viewer's choice for this agent, else "Use my default". */
export const yourAccountValue = (account: ItemAccount | undefined): string =>
    account?.match === "choice" && account.gateway_connection_id
        ? account.gateway_connection_id
        : USE_MY_DEFAULT

/** The viewer's default account among their own, for the line beside "Use my default". */
export const defaultAccountOf = (
    yours: readonly ToolConnection[],
    account: ItemAccount | undefined,
): ToolConnection | undefined =>
    yours.find(isConnectionDefault) ??
    (account?.match === "default"
        ? yours.find((connection) => connection.id === account.gateway_connection_id)
        : undefined)

/**
 * "Shared account" options: the project's connections of the app by slug, and a saved slug whose
 * connection is gone, so the select still shows what is saved.
 */
export const sharedAccountOptions = (
    projectConnections: readonly Pick<ToolConnection, "slug" | "name">[],
    entry: Pick<ParsedGatewayConnection, "accountSource" | "connection">,
): {slug: string; name: string}[] => {
    const options: {slug: string; name: string}[] = []
    const seen = new Set<string>()
    for (const connection of projectConnections) {
        if (!connection.slug || seen.has(connection.slug)) continue
        seen.add(connection.slug)
        options.push({slug: connection.slug, name: connection.name || connection.slug})
    }
    if (
        entry.accountSource !== USER_ACCOUNT_SOURCE &&
        entry.connection &&
        !seen.has(entry.connection)
    )
        options.push({slug: entry.connection, name: entry.connection})
    return options
}

/** An automation as the trigger queries return it: the agent it targets and who it runs as. */
export interface AutomationRunner {
    /**
     * Null for an automation bound through an environment; its `application` or `workflow`
     * reference then names the agent. A binding by variant or revision only is not resolved here.
     */
    artifact_id?: string | null
    data?: {references?: Record<string, {id?: string | null} | undefined> | null} | null
    principal?: {kind?: string | null} | null
}

/**
 * Whether an automation of this agent runs without a person. An automation runs as the principal
 * that created or last saved it: from the app that is a person, from an API key it is not.
 */
export const hasAutomationWithoutPerson = (
    automations: readonly AutomationRunner[],
    workflowId: string,
): boolean =>
    Boolean(workflowId) &&
    automations.some(
        (automation) =>
            (automation.artifact_id ??
                automation.data?.references?.application?.id ??
                automation.data?.references?.workflow?.id) === workflowId &&
            Boolean(automation.principal?.kind) &&
            automation.principal?.kind !== "human",
    )

/**
 * What a pick on the switch does: write the account source, or, for one shared account with no
 * connection to share yet, connect one first (the agent switches once it exists).
 */
export const accountSourcePick = (
    next: string,
    entry: Pick<ParsedGatewayConnection, "connection">,
    shared: readonly {slug: string}[],
): {write: GatewayConnectionAccount} | {connect: "project"} => {
    if (next === USER_ACCOUNT_SOURCE) return {write: {accountSource: USER_ACCOUNT_SOURCE}}
    const slug = entry.connection || shared[0]?.slug
    return slug ? {write: {accountSource: "agent", slug}} : {connect: "project"}
}
