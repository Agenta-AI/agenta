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
    mcps: number
    skills: number
    sandbox: string | null
    /** Default tool permission, e.g. "allow_reads". */
    permissions: string | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value)

const str = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null

const count = (value: unknown): number => (Array.isArray(value) ? value.length : 0)

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
        mcps: count(agent.mcps),
        skills: count(agent.skills),
        sandbox: prettifyKind(str(nested(agent, "sandbox")?.kind)),
        permissions: prettifyKind(str(nested(nested(agent, "runner"), "permissions")?.default)),
    }
}
