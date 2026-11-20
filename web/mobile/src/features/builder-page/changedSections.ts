import type {MarkableSectionKey} from "@agenta/entity-ui/drill-in"

const SCAFFOLDING = new Set(["parameters", "agent"])

/** The section of a first segment that is a section of its own. */
const SECTION_OF_HEAD: Record<string, MarkableSectionKey> = {
    instructions: "instructions",
    llm: "model-harness",
    tools: "tools",
    mcps: "mcp",
    skills: "skills",
}

/** A segment's name: the string, or the list of a `{list, key}` selector. */
const segmentName = (segment: unknown): string | null => {
    if (typeof segment === "string") return segment
    const list = (segment as {list?: unknown} | null)?.list
    return typeof list === "string" ? list : null
}

/** The sections one target can change; a whole runner, sandbox or harness spans two. */
const sectionsOfTarget = (target: unknown[]): MarkableSectionKey[] => {
    let at = 0
    while (at < target.length && SCAFFOLDING.has(target[at] as string)) at++
    const head = segmentName(target[at])
    if (!head) return []
    const whole = at + 1 >= target.length
    const next = segmentName(target[at + 1])
    if (head === "harness")
        return whole
            ? ["model-harness", "advanced"]
            : [next === "kind" ? "model-harness" : "advanced"]
    if (head === "runner")
        return whole
            ? ["permissions", "advanced"]
            : [next === "permissions" ? "permissions" : "advanced"]
    if (head === "sandbox")
        return whole ? ["secrets", "advanced"] : [next === "credentials" ? "secrets" : "advanced"]
    return [SECTION_OF_HEAD[head] ?? "advanced"]
}

/**
 * The agent panel sections an `edit_agent_config` call changed (task 41.2), from the first
 * segment of each operation target after `parameters` and `agent`. Nested fields follow the
 * panel's grouping (`commitDiff/classify.ts`, mapped in `sectionChanges.ts`): `harness.kind` is in
 * Model, `runner.permissions` in Permissions, `sandbox.credentials` in Secrets, the other runner,
 * sandbox and harness fields in Advanced; a whole runner, sandbox or harness marks both of its
 * sections. A target with no segment after the scaffolding (the
 * whole agent) marks nothing: there is no one row to point at.
 */
export const sectionsOfOperations = (operations: unknown): MarkableSectionKey[] => {
    if (!Array.isArray(operations)) return []
    const keys = new Set<MarkableSectionKey>()
    for (const operation of operations) {
        const target = (operation as {target?: unknown} | null)?.target
        if (!Array.isArray(target)) continue
        for (const section of sectionsOfTarget(target)) keys.add(section)
    }
    return [...keys]
}
