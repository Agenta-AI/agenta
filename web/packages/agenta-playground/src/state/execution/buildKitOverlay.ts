/**
 * Build-kit overlay merge — the playground-only overlay applied to the throwaway agent run copy.
 *
 * Extracted from `agentRequest.ts` so the request builder stays focused on composing the
 * `/invoke` envelope. None of this touches the draft or the commit tree: `applyBuildKitOverlay`
 * returns new objects and the request builder applies it only to the per-run `parameters`.
 *
 * Merge semantics:
 *  - object sections (`sandbox`/`runner`/`harness`/`llm`/`instructions`) deep-merge (overlay wins
 *    at the leaf),
 *  - list sections (`tools`/`skills`/`mcps`) identity-merge: an overlay entry replaces a base entry
 *    with the same identity (platform op, embed slug, or name), otherwise it is appended.
 */
import {type AgentTemplate} from "@agenta/entities/workflow"

type AgentTemplateListKey = "tools" | "skills" | "mcps"
type AgentTemplateObjectKey = "sandbox" | "runner" | "harness" | "llm" | "instructions"

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

const embedWorkflowSlug = (entry: unknown): string | undefined => {
    if (!isRecord(entry)) return undefined
    const embed = entry["@ag.embed"]
    if (!isRecord(embed)) return undefined
    const refs = embed["@ag.references"]
    if (!isRecord(refs)) return undefined
    const workflow = refs.workflow
    if (isRecord(workflow) && typeof workflow.slug === "string") return workflow.slug
    const revision = refs.workflow_revision
    if (isRecord(revision) && typeof revision.slug === "string") return revision.slug
    return undefined
}

const deepMerge = (
    base: Record<string, unknown>,
    overlay: Record<string, unknown>,
): Record<string, unknown> => {
    const result: Record<string, unknown> = {...base}
    for (const [key, value] of Object.entries(overlay)) {
        const existing = result[key]
        result[key] = isRecord(existing) && isRecord(value) ? deepMerge(existing, value) : value
    }
    return result
}

const getToolIdentity = (entry: unknown): string | undefined => {
    if (!isRecord(entry)) return undefined
    if (entry.type === "platform" && typeof entry.op === "string") return `platform:${entry.op}`
    const slug = embedWorkflowSlug(entry)
    if (slug) return `workflow:${slug}`
    return typeof entry.name === "string" ? `name:${entry.name}` : undefined
}

const getSkillIdentity = (entry: unknown): string | undefined => {
    const slug = embedWorkflowSlug(entry)
    return slug ? `workflow:${slug}` : undefined
}

const getMcpIdentity = (entry: unknown): string | undefined => {
    if (!isRecord(entry)) return undefined
    return typeof entry.name === "string" ? entry.name : undefined
}

const identityMerge = (
    base: unknown[],
    overlay: unknown[],
    getIdentity: (entry: unknown) => string | undefined,
): unknown[] => {
    const result = [...base]
    const indexByIdentity = new Map<string, number>()
    result.forEach((entry, index) => {
        const identity = getIdentity(entry)
        if (identity) indexByIdentity.set(identity, index)
    })
    overlay.forEach((entry) => {
        const identity = getIdentity(entry)
        const index = identity ? indexByIdentity.get(identity) : undefined
        if (index !== undefined) {
            result[index] = entry
            return
        }
        if (identity) indexByIdentity.set(identity, result.length)
        result.push(entry)
    })
    return result
}

export function applyBuildKitOverlay(
    base: AgentTemplate,
    overlay: Partial<AgentTemplate>,
): AgentTemplate {
    const result: AgentTemplate = {...base}

    for (const key of [
        "sandbox",
        "runner",
        "harness",
        "llm",
        "instructions",
    ] as const satisfies readonly AgentTemplateObjectKey[]) {
        const overlayValue = overlay[key]
        if (overlayValue !== undefined) {
            result[key] = deepMerge(
                isRecord(base[key]) ? (base[key] as Record<string, unknown>) : {},
                isRecord(overlayValue) ? overlayValue : {},
            )
        }
    }

    const listMergers: Record<AgentTemplateListKey, (entry: unknown) => string | undefined> = {
        tools: getToolIdentity,
        skills: getSkillIdentity,
        mcps: getMcpIdentity,
    }

    for (const key of Object.keys(listMergers) as AgentTemplateListKey[]) {
        const overlayValue = overlay[key]
        if (Array.isArray(overlayValue)) {
            result[key] = identityMerge(
                Array.isArray(base[key]) ? (base[key] as unknown[]) : [],
                overlayValue,
                listMergers[key],
            )
        }
    }

    return result
}

/**
 * Apply the overlay to the run parameters. Handles both shapes `buildAgentRequest` produces: a
 * `{agent: <template>}` wrapper and a bare template (no `agent` key). Skipping the bare shape would
 * silently drop the build kit for the bare published default.
 */
export const withBuildKitOverlay = (
    parameters: Record<string, unknown>,
    overlay: AgentTemplate | null,
    enabled: boolean,
): Record<string, unknown> => {
    if (!enabled || !overlay) return parameters
    if (isRecord(parameters.agent)) {
        return {
            ...parameters,
            agent: applyBuildKitOverlay(parameters.agent as AgentTemplate, overlay),
        }
    }
    return applyBuildKitOverlay(parameters as AgentTemplate, overlay) as Record<string, unknown>
}
