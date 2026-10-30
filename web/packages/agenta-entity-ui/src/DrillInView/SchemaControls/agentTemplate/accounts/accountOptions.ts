/**
 * The "Account" select of a Composio item: its options and what a pick writes. Pure, so the
 * tests and the block run the same rule.
 */
import {USER_ACCOUNT_SOURCE, type AccountSource} from "@agenta/entities/accountChoice"
import type {ToolConnection} from "@agenta/entities/gatewayTool"

import {ACCOUNT_COPY} from "../../../../accounts/copy"
import type {GatewayConnectionAccount, ParsedGatewayConnection} from "../../toolUtils"
import type {PermissionPolicyOption} from "../PermissionPolicySelect"

/** The MCP select. Each person's own sign-in is left out where a person cannot sign in. */
export const mcpAccountOptions = ({
    source,
    personalAccounts,
    authMode,
}: {
    source: AccountSource
    personalAccounts: boolean
    authMode: string | undefined
}): PermissionPolicyOption[] => {
    const offerUser = (personalAccounts && authMode !== "none") || source === USER_ACCOUNT_SOURCE
    return [
        ...(offerUser ? [{value: USER_ACCOUNT_SOURCE, title: ACCOUNT_COPY.eachPersonSignIn}] : []),
        {value: "agent", title: ACCOUNT_COPY.projectSignIn},
    ]
}

/** The select value of a project connection is `project:<slug>`; each person's own is `"user"`. */
const PROJECT_PREFIX = "project:"

export const integrationAccountValue = (
    entry: Pick<ParsedGatewayConnection, "accountSource" | "connection">,
): string =>
    entry.accountSource === USER_ACCOUNT_SOURCE
        ? USER_ACCOUNT_SOURCE
        : `${PROJECT_PREFIX}${entry.connection}`

export const integrationAccountFromValue = (value: string): GatewayConnectionAccount =>
    value === USER_ACCOUNT_SOURCE
        ? {accountSource: USER_ACCOUNT_SOURCE}
        : {accountSource: "agent", slug: value.slice(PROJECT_PREFIX.length)}

/**
 * "Each person's default <name>" first, then each project connection of the integration. The
 * first option is left out when personal accounts are off, unless the item already uses it: the
 * select must still be able to show what is saved.
 */
export const integrationAccountOptions = ({
    integrationName,
    projectConnections,
    entry,
    personalAccounts,
}: {
    integrationName: string
    projectConnections: Pick<ToolConnection, "slug" | "name">[]
    entry: Pick<ParsedGatewayConnection, "accountSource" | "connection">
    personalAccounts: boolean
}): PermissionPolicyOption[] => {
    const options: PermissionPolicyOption[] = []
    if (personalAccounts || entry.accountSource === "user") {
        options.push({
            value: USER_ACCOUNT_SOURCE,
            title: ACCOUNT_COPY.eachPersonDefault(integrationName),
        })
    }
    const slugs = new Set<string>()
    for (const connection of projectConnections) {
        if (!connection.slug || slugs.has(connection.slug)) continue
        slugs.add(connection.slug)
        options.push({
            value: `${PROJECT_PREFIX}${connection.slug}`,
            title: connection.name || connection.slug,
        })
    }
    // A saved slug whose connection is gone still shows as the value.
    if (entry.accountSource !== "user" && entry.connection && !slugs.has(entry.connection)) {
        options.push({value: `${PROJECT_PREFIX}${entry.connection}`, title: entry.connection})
    }
    return options
}
