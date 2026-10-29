/**
 * The run person notice (spec 3.8 and 5.6): saving an automation makes the editor the person it
 * runs as, so an agent with "user" items will use the editor's own accounts. Pure, so the notice
 * and its tests run the same rule.
 */
import type {WorkflowRevisionRefs} from "@agenta/entities/workflow"

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

/**
 * Shown only when there is an edit to save, the save changes the run person, and the agent the
 * automation will run has "user" items. Never a reason to block the save.
 */
export const runPersonNoticeShown = ({
    dirty,
    principal,
    viewerId,
    agentHasUserItems,
}: {
    dirty: boolean
    principal: PrincipalRefLike | null | undefined
    viewerId: string | null | undefined
    agentHasUserItems: boolean
}): boolean => dirty && agentHasUserItems && saveChangesRunPerson(principal, viewerId)

type StoredRefs = Record<string, {id?: string | null} | null | undefined> | null | undefined

/**
 * The references the next run resolves: the stored ones, or the newest revision of the agent the
 * draft rebinds to. An environment binding falls back to the agent's newest revision.
 */
export const automationRevisionRefs = (
    automation: Pick<Automation, "agentId" | "raw">,
    draftAgentId: string | null,
): WorkflowRevisionRefs | null => {
    if (draftAgentId && draftAgentId !== automation.agentId) return {workflowId: draftAgentId}
    const stored = automation.raw.data?.references as StoredRefs
    const revisionId = stored?.workflow_revision?.id ?? stored?.application_revision?.id
    const variantId = stored?.workflow_variant?.id ?? stored?.application_variant?.id
    const workflowId =
        stored?.workflow?.id ?? stored?.application?.id ?? automation.agentId ?? draftAgentId
    if (!revisionId && !variantId && !workflowId) return null
    return {workflowId, variantId, revisionId}
}
