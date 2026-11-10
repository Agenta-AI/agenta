/**
 * The run person notice (spec 3.8 and 5.6): saving an automation makes the editor the person it
 * runs as, so an agent with "user" items will use the editor's own accounts. Pure, so the notice
 * and its tests run the same rule.
 */
import type {TriggerReference} from "@agenta/entities/gatewayTrigger"
import type {WorkflowReference, WorkflowRevisionRefs} from "@agenta/entities/workflow"

import type {Automation} from "./automationModel"

/** The trigger's executing principal, as the trigger response returns it. */
export interface PrincipalRefLike {
    kind: string
    id: string
}

/** Whether a save would make the viewer the automation's run person. */
export const saveChangesRunPerson = (
    principal: PrincipalRefLike | null | undefined,
    viewerId: string | null | undefined,
): boolean => Boolean(viewerId) && !(principal?.kind === "human" && principal.id === viewerId)

/** The id, slug and version a stored reference has; nothing when it names none. */
const storedRef = (ref: TriggerReference | null | undefined): WorkflowReference | undefined => {
    if (!ref) return undefined
    const out: WorkflowReference = {
        ...(ref.id ? {id: ref.id} : {}),
        ...(ref.slug ? {slug: ref.slug} : {}),
        ...(ref.version ? {version: ref.version} : {}),
    }
    return Object.keys(out).length > 0 ? out : undefined
}

/** The reference families a trigger stores, in the order the trigger service reads them. */
const FAMILIES = ["application", "evaluator", "workflow"] as const

/**
 * The references the next run reads, as the trigger service reads them: the stored family (an
 * environment binding included, with the key `<agent slug>.revision`). For an unsaved rebind, the
 * references Save writes: the agent and the variant of its newest revision (`rebindVariantId`,
 * null while it loads).
 */
export const automationRevisionRefs = (
    automation: Pick<Automation, "agentId" | "raw">,
    draftAgentId: string | null,
    rebindVariantId: string | null = null,
): WorkflowRevisionRefs | null => {
    if (draftAgentId && draftAgentId !== automation.agentId) {
        return {
            workflow: {id: draftAgentId},
            ...(rebindVariantId ? {variant: {id: rebindVariantId}} : {}),
        }
    }
    const stored = (automation.raw.data?.references ?? {}) as Record<
        string,
        TriggerReference | null | undefined
    >
    const family = FAMILIES.find((name) =>
        [name, `${name}_variant`, `${name}_revision`].some((key) => stored[key]),
    )
    const environment = storedRef(stored.environment)
    if (!family && !environment) return null
    const workflow = family ? storedRef(stored[family]) : undefined
    return {
        workflow,
        variant: family ? storedRef(stored[`${family}_variant`]) : undefined,
        revision: family ? storedRef(stored[`${family}_revision`]) : undefined,
        environment,
        key: environment && workflow?.slug ? `${workflow.slug}.revision` : undefined,
    }
}
