/**
 * Reduce an agent revision's `parameters` to the handful of facts an overview row can state.
 *
 * Shape (verified against stored revisions): `parameters.agent` carries `llm{model,provider}`,
 * `harness{kind}`, `sandbox{kind}`, `runner{kind,permissions{default}}`,
 * `instructions{agents_md}` and the flat `tools` / `mcps` / `skills` arrays.
 *
 * Everything is optional on purpose: a revision written before a field existed, or an agent that
 * never set one, yields `null` and the row says so rather than the card failing to render.
 */
export interface AgentConfigSummary {
    model: string | null
    harness: string | null
    /** Word count of AGENTS.md, so the row can say how much instruction there is. */
    instructionWords: number | null
    /** The brief itself, raw — `InstructionsFileRow` derives its own preview from the markdown. */
    instructions: string | null
    tools: number
    /** The integration behind each gateway-connection tool (`linear`, `github`), in tool order,
     * deduplicated — so an overview can show the marks rather than only the count. */
    integrationKeys: string[]
    mcps: number
    skills: number
    /** Display names of the agent's skills (embed refs by their sibling name/slug, inline
     * packages by their own name), so the overview row can list them. */
    skillNames: string[]
    sandbox: string | null
    /** Default tool permission, e.g. "allow_reads". */
    permissions: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const str = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

/** A skill entry's display name: the sibling `name` (embed refs carry it too), else the
 * referenced workflow slug, else null (an unparseable entry stays counted but unnamed). */
const skillName = (entry: unknown): string | null => {
    if (!isRecord(entry)) return null
    const name = str(entry.name)
    if (name) return name
    const refs = nested(nested(entry, "@ag.embed"), "@ag.references")
    const slug = str(nested(refs, "workflow")?.slug) ?? str(nested(refs, "workflow_revision")?.slug)
    return slug
}

/** A gateway-connection tool's integration key; null for a custom or builtin tool. */
const integrationKey = (entry: unknown): string | null =>
    isRecord(entry) && entry.type === "gateway_connection"
        ? str(nested(entry, "connection")?.integration)
        : null

const nested = (parent: unknown, key: string): Record<string, unknown> | null => {
    if (!isRecord(parent)) return null
    const child = parent[key]
    return isRecord(child) ? child : null
}

/** `pi_core` → `Pi core`. No lookup table: a wrong friendly name is worse than a plain one. */
export function prettifyKind(kind: string | null): string | null {
    if (!kind) return null
    const spaced = kind.replace(/[_-]+/g, " ").trim()
    return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : null
}

export function agentConfigSummary(parameters: unknown): AgentConfigSummary {
    const agent = nested(parameters, "agent") ?? (isRecord(parameters) ? parameters : {})

    const instructions = str(nested(agent, "instructions")?.agents_md)

    return {
        model: str(nested(agent, "llm")?.model),
        harness: prettifyKind(str(nested(agent, "harness")?.kind)),
        // Whitespace-split rather than a token count: this is "how long is the brief", not billing.
        instructionWords: instructions ? instructions.split(/\s+/).filter(Boolean).length : null,
        instructions,
        tools: count(agent.tools),
        integrationKeys: Array.isArray(agent.tools)
            ? [
                  ...new Set(
                      agent.tools.map(integrationKey).filter((key): key is string => Boolean(key)),
                  ),
              ]
            : [],
        mcps: count(agent.mcps),
        skills: count(agent.skills),
        skillNames: Array.isArray(agent.skills)
            ? agent.skills.map(skillName).filter((name): name is string => Boolean(name))
            : [],
        sandbox: prettifyKind(str(nested(agent, "sandbox")?.kind)),
        permissions: prettifyKind(str(nested(nested(agent, "runner"), "permissions")?.default)),
    }
}

/**
 * What the MCP servers row says, on every summary card in both apps.
 *
 * "configured", not "connected": this counts the servers on the agent, and whether each one
 * is authorized is a live fact no summary card holds. Saying "connected" claimed the
 * authorized state for a disconnected server, in the one word the rest of the product now
 * reserves for it (round 4, D5). The rule lives here because the mobile card is a fork of
 * the shared one and drifted back to the wrong word once already.
 */
export const mcpSummaryDetail = (mcps: number, {canEdit = false} = {}): string =>
    mcps ? `${mcps} configured` : canEdit ? "Connect a server" : "None configured"

/**
 * The rows every agent summary card shows, in order, with the title each one carries.
 *
 * The two cards are not one component: the desktop one renders the playground panel's
 * accordion sections and the mobile one renders the overview rail's own shell, which its two
 * sibling cards share so the three read as one column. What must not differ is WHICH rows there
 * are and what they are called. The mobile card was missing `permissions` entirely and had
 * drifted on the MCP row's wording, which is the same failure twice, so the vocabulary lives
 * here and both cards read it.
 *
 * The tools row's noun is the one variable: the mobile card calls it Integrations.
 */
export const AGENT_CONFIG_ROW_KEYS = [
    "model",
    "instructions",
    "tools",
    "mcps",
    "skills",
    "permissions",
] as const

export type AgentConfigRowKey = (typeof AGENT_CONFIG_ROW_KEYS)[number]

export const AGENT_CONFIG_ROW_TITLES: Record<AgentConfigRowKey, string> = {
    model: "Model",
    instructions: "Instructions",
    tools: "Tools",
    mcps: "MCP servers",
    skills: "Skills",
    permissions: "Permissions",
}

/**
 * What the permissions row says. "Not set" rather than a blank: a revision written before the
 * field existed has no default, and an empty right-hand side reads as a value that failed to
 * load.
 */
export const permissionsSummaryDetail = (permissions: string | null): string =>
    permissions || "Not set"
