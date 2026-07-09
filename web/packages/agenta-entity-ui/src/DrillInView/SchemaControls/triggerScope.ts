import type {TriggerReference} from "@agenta/entities/gatewayTrigger"
import type {Workflow} from "@agenta/entities/workflow"

export const AGENT_TRIGGER_ORIGIN_META_KEY = "agenta_agent_trigger_origin"

export interface AgentTriggerOrigin {
    revision_id: string
    variant_id?: string | null
    revision_version?: number | null
}

export interface AgentTriggerContext {
    revisionId: string | null
    variantId: string | null
    revisionVersion: number | null
}

export interface AgentTriggerEntity {
    data?: {
        references?: Record<string, TriggerReference> | null
    } | null
    meta?: Record<string, unknown> | null
}

function finiteNumber(value: unknown): number | null {
    const number = typeof value === "number" ? value : Number(value)
    return Number.isFinite(number) ? number : null
}

export function getAgentTriggerContext(
    entityId: string | null,
    revision: Workflow | null | undefined,
): AgentTriggerContext {
    return {
        revisionId: entityId,
        variantId: revision?.workflow_variant_id ?? revision?.variant_id ?? null,
        revisionVersion: finiteNumber(revision?.version),
    }
}

export function buildAgentTriggerOrigin(context: AgentTriggerContext): AgentTriggerOrigin | null {
    if (!context.revisionId) return null
    return {
        revision_id: context.revisionId,
        variant_id: context.variantId,
        revision_version: context.revisionVersion,
    }
}

export function addAgentTriggerOriginMeta(
    meta: Record<string, unknown> | null | undefined,
    origin: AgentTriggerOrigin | null,
): Record<string, unknown> | null {
    if (!origin) return meta ?? null
    return {
        ...(meta ?? {}),
        [AGENT_TRIGGER_ORIGIN_META_KEY]: origin,
    }
}

function readAgentTriggerOrigin(
    meta: Record<string, unknown> | null | undefined,
): AgentTriggerOrigin | null {
    const raw = meta?.[AGENT_TRIGGER_ORIGIN_META_KEY]
    if (!raw || typeof raw !== "object") return null
    const value = raw as Record<string, unknown>
    const revisionId = typeof value.revision_id === "string" ? value.revision_id : null
    if (!revisionId) return null
    return {
        revision_id: revisionId,
        variant_id: typeof value.variant_id === "string" ? value.variant_id : null,
        revision_version: finiteNumber(value.revision_version),
    }
}

/** Whether any id in a trigger's `data.references` matches one of the agent's ids. */
function referencesMatch(
    references: Record<string, TriggerReference> | null | undefined,
    agentIds: Set<string>,
): boolean {
    if (!references || agentIds.size === 0) return false
    for (const ref of Object.values(references)) {
        if (ref?.id && agentIds.has(ref.id)) return true
    }
    return false
}

function revisionReferenceMatches(
    references: Record<string, TriggerReference> | null | undefined,
    revisionId: string | null,
): boolean {
    if (!references || !revisionId) return false
    return (
        references.application_revision?.id === revisionId ||
        references.workflow_revision?.id === revisionId ||
        references.evaluator_revision?.id === revisionId
    )
}

// Origin-scoped triggers show on the revision they were created on and any later
// revision of the same variant; never on earlier revisions or sibling variants.
function originMatchesContext(origin: AgentTriggerOrigin, context: AgentTriggerContext): boolean {
    if (origin.revision_id === context.revisionId) return true
    if (!origin.variant_id || origin.variant_id !== context.variantId) return false
    if (origin.revision_version == null || context.revisionVersion === null) return false
    return context.revisionVersion >= origin.revision_version
}

export function agentTriggerMatchesContext(
    trigger: AgentTriggerEntity,
    context: AgentTriggerContext,
    agentIds: Set<string>,
): boolean {
    const references = trigger.data?.references
    const origin = readAgentTriggerOrigin(trigger.meta)

    if (origin) {
        return originMatchesContext(origin, context)
    }

    if (revisionReferenceMatches(references, context.revisionId)) {
        return true
    }

    return referencesMatch(references, agentIds)
}
