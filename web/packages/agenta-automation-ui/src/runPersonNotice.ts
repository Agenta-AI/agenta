/**
 * The run person notice (spec 3.8 and 5.6): saving an automation makes the editor the person it
 * runs as, so an agent with "user" items will use the editor's own accounts. Pure, so the notice
 * and its tests run the same rule.
 */
import type {StoredRef, WorkflowRevisionRefs} from "@agenta/entities/workflow"

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

type RawRef = {id?: string | null; slug?: string | null; version?: string | null} | null | undefined

/** The id, slug and version a stored reference has; nothing when it names none. */
const storedRef = (ref: RawRef): StoredRef | undefined => {
    if (!ref) return undefined
    const out: StoredRef = {
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
 * environment binding included, with the key `<agent slug>.revision`), or the newest revision of
 * the agent an unsaved rebind names.
 */
export const automationRevisionRefs = (
    automation: Pick<Automation, "agentId" | "raw">,
    draftAgentId: string | null,
): WorkflowRevisionRefs | null => {
    if (draftAgentId && draftAgentId !== automation.agentId) return {workflow: {id: draftAgentId}}
    const stored = (automation.raw.data?.references ?? {}) as Record<string, RawRef>
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
