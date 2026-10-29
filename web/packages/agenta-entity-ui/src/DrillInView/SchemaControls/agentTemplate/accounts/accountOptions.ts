/**
 * The "Account" select of a Composio item: its options and what a pick writes. Pure, so the
 * tests and the block run the same rule.
 */
import type {ToolConnection} from "@agenta/entities/gatewayTool"

import type {GatewayConnectionAccount, ParsedGatewayConnection} from "../../toolUtils"
import type {PermissionPolicyOption} from "../PermissionPolicySelect"

import {ACCOUNT_COPY} from "./copy"

export type McpAccountSource = "user" | "project"

/** The MCP select. Each person's own sign-in is left out where a person cannot sign in. */
export const mcpAccountOptions = ({
    source,
    personalAccounts,
    authMode,
}: {
    source: McpAccountSource
    personalAccounts: boolean
    authMode: string | undefined
}): PermissionPolicyOption[] => {
    const offerUser = (personalAccounts && authMode !== "none") || source === "user"
    return [
        ...(offerUser ? [{value: "user", title: ACCOUNT_COPY.eachPersonSignIn}] : []),
        {value: "project", title: ACCOUNT_COPY.projectSignIn},
    ]
}

/** The select value of each person's own account. A project connection is `project:<slug>`. */
export const USER_ACCOUNT_VALUE = "user"

const PROJECT_PREFIX = "project:"

export const integrationAccountValue = (
    entry: Pick<ParsedGatewayConnection, "accountSource" | "connection">,
): string =>
    entry.accountSource === "user" ? USER_ACCOUNT_VALUE : `${PROJECT_PREFIX}${entry.connection}`

export const integrationAccountFromValue = (value: string): GatewayConnectionAccount =>
    value === USER_ACCOUNT_VALUE
        ? {kind: "user"}
        : {kind: "project", slug: value.slice(PROJECT_PREFIX.length)}

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
            value: USER_ACCOUNT_VALUE,
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
