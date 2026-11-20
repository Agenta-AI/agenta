import type {WorkflowReferenceBridge} from "@agenta/ui/drill-in"
import type {ConfigItemRef} from "@agenta/ui/view-stack"

import {toolReferenceSlug} from "./itemDescriptors"

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

const sharesKey = (tools: unknown[], key: string) =>
    tools.filter((tool) => subagentItemKey(tool) === key).length > 1

/**
 * The prefix of a view-only address by slug. Engine keys are tool names, which hold no "@", so a
 * slug address can never be read as an engine key.
 */
const SLUG_REF = "@slug:"

/** A view-only address of the subagent entry with this `slug`. */
export const subagentSlugRef = (slug: string): ConfigItemRef => ({
    list: "tools",
    key: `${SLUG_REF}${slug}`,
})

/**
 * The address of a subagent in the agent's `tools`, or null for an entry with no key. It is the
 * engine's key, except when two legacy entries share a copied `name`: the engine refuses such a
 * list (duplicate item key), and the view then addresses the entry by its `slug`, so opening or
 * removing the second one never touches the first.
 */
export function subagentItemRef(tool: unknown, tools: unknown[]): ConfigItemRef | null {
    const key = subagentItemKey(tool)
    if (!key) return null
    const slug = toolReferenceSlug(tool)
    return sharesKey(tools, key) && slug ? subagentSlugRef(slug) : {list: "tools", key}
}

/**
 * The index of the subagent `ref` names in the tools as they are now, or -1: the one entry with
 * that engine key, or for a slug address the one entry with that slug. An address that matches
 * more than one entry names none.
 */
export function findSubagentIndex(tools: unknown[], ref: ConfigItemRef): number {
    if (ref.list !== "tools") return -1
    const slug = ref.key.startsWith(SLUG_REF) ? ref.key.slice(SLUG_REF.length) : null
    const matches = tools.flatMap((tool, index) =>
        (slug !== null ? toolReferenceSlug(tool) === slug : subagentItemKey(tool) === ref.key)
            ? [index]
            : [],
    )
    return matches.length === 1 ? matches[0] : -1
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

/** The agent's `tools`, or an empty list. */
export const toolsOf = (agent: Record<string, unknown>): unknown[] =>
    Array.isArray(agent.tools) ? (agent.tools as unknown[]) : []

/**
 * A new subagent entry for the agent `slug` names, with the model-facing input schema of its
 * latest revision. No `name`: that copy went stale on a rename (#6444). The description is
 * authored on the calling agent, seeded from the target's own description.
 */
export async function buildSubagentReference(
    bridge: WorkflowReferenceBridge,
    slug: string,
): Promise<Record<string, unknown>> {
    const workflow = bridge.workflows.find((w) => w.slug === slug)
    let inputSchema: Record<string, unknown> | null = null
    try {
        inputSchema = workflow ? ((await bridge.resolveInputSchema(workflow)) ?? null) : null
    } catch {
        inputSchema = null
    }
    return normalizeSubagentReference({
        slug,
        description: workflow?.description ?? "",
        input_schema: inputSchema ?? {type: "object", properties: {}},
    })
}

/** The tools with `reference` appended, unless an entry for its agent is there already. */
export const addSubagentReference = (
    tools: unknown[],
    reference: Record<string, unknown>,
): unknown[] =>
    tools.some((tool) => toolReferenceSlug(tool) === reference.slug) ? tools : [...tools, reference]

/**
 * The tools without any entry for the agent `slug` names. The picker removes by slug, not by
 * item key: an older entry that stores a `name` is still the same agent to the person.
 */
export const removeSubagentSlug = (tools: unknown[], slug: string): unknown[] =>
    tools.filter((tool) => toolReferenceSlug(tool) !== slug)
