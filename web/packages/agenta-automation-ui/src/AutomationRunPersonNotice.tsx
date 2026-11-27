/**
 * The notice beside an automation's save bar (spec 5.6): saving makes the viewer the person the
 * automation runs as, and the agent has items that use each person's own account. The save is
 * never blocked.
 *
 * It reads only while there is an edit to save, and only when the save changes the run person.
 */
import {useMemo} from "react"

import {hasUserItems} from "@agenta/entities/accountChoice"
import {
    retrievedWorkflowRevisionQueryAtomFamily,
    workflowLatestRevisionQueryAtomFamily,
    retrievedWorkflowRevisionFamilyKey,
} from "@agenta/entities/workflow"
import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {userAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import type {Automation} from "./automationModel"
import {
    automationRevisionRefs,
    saveChangesRunPerson,
    type PrincipalRefLike,
} from "./runPersonNotice"

export const AutomationRunPersonNotice = ({
    automation,
    draftAgentId,
    dirty,
}: {
    automation: Automation
    /** The agent the draft binds; differs from the saved one while a rebind is unsaved. */
    draftAgentId: string | null
    dirty: boolean
}) => {
    const t = useT(automationsEditorCatalog)
    const viewer = useAtomValue(userAtom)
    const principal = (automation.raw as {principal?: PrincipalRefLike | null}).principal
    const changesRunPerson = dirty && saveChangesRunPerson(principal, viewer?.id)
    // A rebind saves the variant of the agent's newest revision; the draft reads the same query.
    const rebinding = Boolean(draftAgentId && draftAgentId !== automation.agentId)
    const latest = useAtomValue(
        workflowLatestRevisionQueryAtomFamily(
            changesRunPerson && rebinding ? (draftAgentId ?? "") : "",
        ),
    )
    const rebindVariantId = latest.data?.workflow_variant_id ?? null
    const refsKey = useMemo(
        () =>
            changesRunPerson
                ? retrievedWorkflowRevisionFamilyKey(
                      automationRevisionRefs(automation, draftAgentId, rebindVariantId),
                  )
                : "",
        [automation, changesRunPerson, draftAgentId, rebindVariantId],
    )
    const revision = useAtomValue(retrievedWorkflowRevisionQueryAtomFamily(refsKey)).data ?? null
    const agentHasUserItems = Boolean(revision && hasUserItems(revision.parameters?.agent))
    // Shown only when the save changes the run person and the agent has "user" items.
    const shown = changesRunPerson && agentHasUserItems

    if (!shown) return null
    return (
        <div
            role="status"
            className="mt-8 flex flex-col gap-1.5 rounded-lg border border-solid border-border-muted p-3"
        >
            <span className="text-label text-foreground">
                {t("automations.editor.personTitle")}
            </span>
            <span className="text-meta text-muted-foreground">
                {t("automations.editor.personBody")}
            </span>
        </div>
    )
}
