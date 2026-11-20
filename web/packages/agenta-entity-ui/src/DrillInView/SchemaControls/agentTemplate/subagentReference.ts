import type {ConfigItemRef} from "@agenta/ui/view-stack"

/** The one shape a saved subagent may take. A subagent always runs the target agent's latest
 *  revision, so a legacy pin (`version`, `environment`) or a forbidden `variant_id` is dropped
 *  on every write rather than left where no surface can show or clear it. `name` goes with them:
 *  a copy of the target's name went stale on a rename (#6444), so the slug is the only identity a
 *  new write stores. A reference saved before this keeps its copy until the next write, and the
 *  row shows it only as a placeholder until the target's current name resolves. */
export function normalizeSubagentReference(tool: Record<string, unknown>): Record<string, unknown> {
    const {
        variant_id: _variantId,
        version: _version,
        environment: _environment,
        name: _name,
        ref_by: _refBy,
        type: _type,
        ...rest
    } = tool
    return {type: "reference", ref_by: "variant", ...rest}
}

/**
 * The key the change-set engine gives a subagent entry of `tools`: its `name`, else its `slug`.
 * A view addresses the subagent by it, so it and a builder operation name the same entry.
 */
export function subagentItemKey(tool: unknown): string | undefined {
    if (!tool || typeof tool !== "object") return undefined
    const entry = tool as Record<string, unknown>
    if (entry.type !== "reference") return undefined
    if (typeof entry.name === "string" && entry.name) return entry.name
    return typeof entry.slug === "string" && entry.slug ? entry.slug : undefined
}

/** The address of a subagent in the agent's `tools`, or null for an entry with no key. */
export function subagentItemRef(tool: unknown): ConfigItemRef | null {
    const key = subagentItemKey(tool)
    return key ? {list: "tools", key} : null
}

/** The index of the subagent `ref` names in the tools as they are now, or -1. */
export function findSubagentIndex(tools: unknown[], ref: ConfigItemRef): number {
    if (ref.list !== "tools") return -1
    return tools.findIndex((tool) => subagentItemKey(tool) === ref.key)
}

/** The tools without the subagent `ref` names; unchanged when it is gone already. */
export function removeSubagentByRef(tools: unknown[], ref: ConfigItemRef): unknown[] {
    const index = findSubagentIndex(tools, ref)
    return index < 0 ? tools : tools.filter((_, i) => i !== index)
}

/** The tools with the description of the subagent `ref` names set; unchanged when it is gone. */
export function setSubagentDescription(
    tools: unknown[],
    ref: ConfigItemRef,
    description: string,
): unknown[] {
    const index = findSubagentIndex(tools, ref)
    if (index < 0) return tools
    const next = [...tools]
    next[index] = normalizeSubagentReference({
        ...(tools[index] as Record<string, unknown>),
        description,
    })
    return next
}
