import type {MarkableSectionKey} from "@agenta/entity-ui/drill-in"

/**
 * The agent panel sections an `edit_agent_config` call changed (task 41.2), from the first
 * segment of each operation target after `parameters` and `agent`. A list selector
 * (`{list, key}`) names its list. Nested fields follow the panel's own grouping
 * (`sectionChanges.ts`): `harness.kind` is in Model, `runner.permissions` in Permissions,
 * `sandbox.credentials` in Secrets, the other runner, sandbox and harness fields in Advanced.
 */
const SCAFFOLDING = new Set(["parameters", "agent"])

const LIST_SECTION: Record<string, MarkableSectionKey> = {
    instructions: "instructions",
    llm: "model-harness",
    tools: "tools",
    mcps: "mcp",
    skills: "skills",
}

const segmentName = (segment: unknown): string | null => {
    if (typeof segment === "string") return segment
    if (segment && typeof segment === "object") {
        const list = (segment as {list?: unknown; field?: unknown}).list
        const field = (segment as {field?: unknown}).field
        if (typeof list === "string") return list
        if (typeof field === "string") return field
    }
    return null
}

const sectionOfTarget = (target: unknown[]): MarkableSectionKey | null => {
    let at = 0
    while (at < target.length && SCAFFOLDING.has(target[at] as string)) at++
    const head = segmentName(target[at])
    if (!head) return null
    const next = segmentName(target[at + 1])
    if (head === "harness") return next === "kind" || next === null ? "model-harness" : "advanced"
    if (head === "runner") return next === "permissions" ? "permissions" : "advanced"
    if (head === "sandbox") return next === "credentials" ? "secrets" : "advanced"
    return LIST_SECTION[head] ?? "advanced"
}

/** The section keys the operations of one call change, without repeats. */
export const sectionsOfOperations = (operations: unknown): MarkableSectionKey[] => {
    if (!Array.isArray(operations)) return []
    const keys = new Set<MarkableSectionKey>()
    for (const operation of operations) {
        const target = (operation as {target?: unknown} | null)?.target
        if (!Array.isArray(target)) continue
        const section = sectionOfTarget(target)
        if (section) keys.add(section)
    }
    return [...keys]
}
