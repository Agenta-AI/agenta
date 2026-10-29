/**
 * "user" items of an agent configuration: the items each person who runs the agent fills with
 * their own account (accounts package contract, section 5).
 *
 * Pure readers of the agent template (`parameters.agent`). They never parse an item key: the key
 * is built here, from the item, the same way the server's `user_item_key` builds it, so the
 * screens can find an item's `ItemAccount` in the `resolve` answer.
 */

/** The `account_source` value of an item that uses each person's own account. */
export const USER_ACCOUNT_SOURCE = "user" as const

/** The item kinds a "user" item can be. */
export type UserItemKind = "app_connection" | "mcp_server" | "secret" | "subscription"

/** `<kind>:user/<match_text>`, the server's `user_item_key`. */
export const userItemKey = (kind: UserItemKind, matchText: string): string =>
    `${kind}:user/${matchText}`

type Json = Record<string, unknown>

const asRecord = (value: unknown): Json | null =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : [])

const isUser = (ref: unknown): boolean => asRecord(ref)?.account_source === USER_ACCOUNT_SOURCE

/** The "user" Composio tools, MCP servers and sandbox secrets of one agent template. */
export interface AgentUserItems {
    tools: Json[]
    mcps: Json[]
    credentials: Json[]
    /** The model, when its connection is a "user" subscription login. */
    llm: Json | null
}

export const readUserItems = (agent: unknown): AgentUserItems => {
    const template = asRecord(agent) ?? {}
    const tools = asArray(template.tools).filter(
        (tool) =>
            asRecord(tool)?.type === "gateway_connection" && isUser(asRecord(tool)?.connection),
    ) as Json[]
    const mcps = asArray(template.mcps).filter((mcp) => isUser(asRecord(mcp)?.connection)) as Json[]
    const credentials = asArray(asRecord(template.sandbox)?.credentials).filter((credential) =>
        isUser(asRecord(credential)?.secret),
    ) as Json[]
    const llm = asRecord(template.llm)
    return {tools, mcps, credentials, llm: llm && isUser(llm.connection) ? llm : null}
}

/** Whether any item of the agent uses each person's own account. */
export const hasUserItems = (agent: unknown): boolean => {
    const items = readUserItems(agent)
    return (
        items.tools.length > 0 ||
        items.mcps.length > 0 ||
        items.credentials.length > 0 ||
        items.llm !== null
    )
}

/**
 * The smallest `parameters` that `resolve` reads the same "user" items from: only those items,
 * under `agent`. The server's item reader reads `parameters.agent` and never raises, so the rest
 * of the configuration does not change the answer, and an edit elsewhere in the agent does not
 * ask again. Null when the agent has no "user" item.
 */
export const userItemsParameters = (agent: unknown): {agent: Json} | null => {
    if (!hasUserItems(agent)) return null
    const items = readUserItems(agent)
    return {
        agent: {
            ...(items.llm ? {llm: items.llm} : {}),
            tools: items.tools,
            mcps: items.mcps,
            sandbox: {credentials: items.credentials},
        },
    }
}
