/**
 * The notice beside an automation's save bar (spec 5.6): saving makes the viewer the person the
 * automation runs as, and the agent has items that use each person's own account. It lists the
 * items the viewer has not set up, with the same fixes as the chat's "Connect your accounts". The
 * save is never blocked.
 *
 * It reads only while there is an edit to save, and only when the save changes the run person:
 * the revision the references resolve to now, then that revision's Needs setup answer.
 */
import {useMemo} from "react"

import {hasUserItems} from "@agenta/entities/accountChoice"
import {
    agentRequirementsAtomFamily,
    resolvedWorkflowRevisionQueryAtomFamily,
    workflowRevisionRefsKey,
} from "@agenta/entities/workflow"
import {PersonalAccountsCard, personalSetupItems} from "@agenta/entity-ui/onboarding"
import {userAtom} from "@agenta/shared/state"
import {useAtomValue} from "jotai"

import type {Automation} from "./automationModel"
import {
    automationRevisionRefs,
    runPersonNoticeShown,
    saveChangesRunPerson,
    type PrincipalRefLike,
} from "./runPersonNotice"

/** Drafts for the owner's text pass. */
export const RUN_PERSON_COPY = {
    title: "This automation will run as you",
    body: "When you save, it runs with your own accounts for the items that use each person's own account.",
    missing: "Not set up for you yet:",
} as const

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
    const viewer = useAtomValue(userAtom)
    const principal = (automation.raw as {principal?: PrincipalRefLike | null}).principal
    const changes = dirty && saveChangesRunPerson(principal, viewer?.id)
    const refsKey = useMemo(
        () => (changes ? workflowRevisionRefsKey(automationRevisionRefs(automation, draftAgentId)) : ""),
        [automation, changes, draftAgentId],
    )
    const revision = useAtomValue(resolvedWorkflowRevisionQueryAtomFamily(refsKey)).data ?? null
    const agentHasUserItems = Boolean(revision && hasUserItems(revision.parameters?.agent))
    const shown = runPersonNoticeShown({
        dirty,
        principal,
        viewerId: viewer?.id,
        agentHasUserItems,
    })
    const requirements = useAtomValue(agentRequirementsAtomFamily(shown ? (revision?.id ?? "") : ""))
    const items = useMemo(() => personalSetupItems(requirements), [requirements])
    const pendingKeys = useMemo(() => new Set(items.map((item) => item.key)), [items])
    const workflowId = revision?.workflowId ?? ""

    if (!shown) return null
    return (
        <div
            role="status"
            className="mt-[30px] flex flex-col gap-1.5 rounded-lg border border-solid border-[var(--ag-colorBorderSecondary)] p-3"
        >
            <span className="text-xs font-medium text-[var(--ag-colorText)]">
                {RUN_PERSON_COPY.title}
            </span>
            <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                {RUN_PERSON_COPY.body}
            </span>
            {items.length > 0 && workflowId ? (
                <>
                    <span className="pt-1 text-xs text-[var(--ag-colorTextSecondary)]">
                        {RUN_PERSON_COPY.missing}
                    </span>
                    <PersonalAccountsCard
                        bare
                        className="-mx-4"
                        workflowId={workflowId}
                        items={items}
                        pendingKeys={pendingKeys}
                    />
                </>
            ) : null}
        </div>
    )
}
