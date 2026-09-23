/**
 * The AGENTS.md text of an agent template's `instructions` value.
 *
 * The stored contract is the object form `{agents_md: "..."}`, and every write keeps it. Some
 * stored revisions carry a bare string instead, which the SDK reads as shorthand for
 * `{agents_md: <string>}`; readers here accept it too so the playground shows the text the agent
 * actually runs with. Any other shape yields `null`.
 */
export function agentInstructionsText(instructions: unknown): string | null {
    if (typeof instructions === "string") return instructions
    if (typeof instructions === "object" && instructions !== null && !Array.isArray(instructions)) {
        const agentsMd = (instructions as Record<string, unknown>).agents_md
        return typeof agentsMd === "string" ? agentsMd : null
    }
    return null
}
