/**
 * The agent's `agenta_tools` entry: which Agenta tools every run of the agent gets, and whether
 * each one asks first. A tool that is not in the map is off.
 */
export type AgentaToolsMap = Record<string, "allow" | "ask">

/** What a new agent's entry holds. Mirrors `DEFAULT_AGENTA_TOOLS` in the SDK. */
export const DEFAULT_AGENTA_TOOLS: AgentaToolsMap = {
    get_current_session: "allow",
    rename_session: "allow",
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const isEntry = (tool: unknown) => isRecord(tool) && tool.type === "agenta_tools"

/** The entry's map, or null when the agent has no entry. */
export function readAgentaTools(tools: unknown): AgentaToolsMap | null {
    const entry = Array.isArray(tools) ? tools.find(isEntry) : undefined
    if (!entry) return null
    return Object.fromEntries(
        Object.entries(isRecord(entry.tools) ? entry.tools : {}).filter(
            ([, value]) => value === "allow" || value === "ask",
        ),
    ) as AgentaToolsMap
}

/** `tools` with the entry's map replaced, or the entry appended when there is none. */
export function writeAgentaTools(tools: unknown[], map: AgentaToolsMap): unknown[] {
    const entry = {type: "agenta_tools", tools: map}
    return tools.some(isEntry)
        ? tools.map((tool) => (isEntry(tool) ? entry : tool))
        : [...tools, entry]
}

/**
 * An agent saved before Agenta tools existed gets the default entry in its LOADED configuration,
 * so the draft stays clean, nothing is committed on open, and the next save stores it. An
 * existing entry is never changed, even an empty one.
 */
export function withAgentaToolsEntry<T>(revision: T): T {
    const data = (revision as {data?: {parameters?: {agent?: unknown}}} | null)?.data
    const agent = data?.parameters?.agent
    if (!isRecord(agent) || readAgentaTools(agent.tools)) return revision
    const tools = Array.isArray(agent.tools) ? agent.tools : []
    return {
        ...revision,
        data: {
            ...data,
            parameters: {
                ...data?.parameters,
                agent: {...agent, tools: writeAgentaTools(tools, DEFAULT_AGENTA_TOOLS)},
            },
        },
    }
}
