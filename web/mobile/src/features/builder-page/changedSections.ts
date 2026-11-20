/**
 * The agent panel sections an `edit_agent_config` call changed (task 41.2): the first segment of
 * each operation target after `parameters` and `agent`, as the panel names its sections. A list
 * selector (`{list, key}`) names its list. A target the panel has no section for lands in
 * Advanced.
 */
const SCAFFOLDING = new Set(["parameters", "agent"])

const SECTION_OF: Record<string, string> = {
    instructions: "instructions",
    llm: "model-harness",
    llms: "model-harness",
    model: "model-harness",
    harness: "model-harness",
    tools: "tools",
    mcps: "mcp",
    skills: "skills",
    subagents: "subagents",
    agents: "subagents",
    secrets: "secrets",
    permissions: "permissions",
}

const headOf = (target: unknown[]): string | null => {
    let at = 0
    while (at < target.length && SCAFFOLDING.has(target[at] as string)) at++
    const head = target[at]
    if (typeof head === "string") return head
    if (head && typeof head === "object") {
        const list =
            (head as {list?: unknown; field?: unknown}).list ?? (head as {field?: unknown}).field
        if (typeof list === "string") return list
    }
    return null
}

/** The section keys the operations of one call change, without repeats. */
export const changedSections = (operations: unknown): string[] => {
    if (!Array.isArray(operations)) return []
    const keys = new Set<string>()
    for (const operation of operations) {
        const target = (operation as {target?: unknown} | null)?.target
        if (!Array.isArray(target)) continue
        const head = headOf(target)
        if (head) keys.add(SECTION_OF[head] ?? "advanced")
    }
    return [...keys]
}
