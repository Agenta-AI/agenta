/**
 * The account one "user" item gets when the person who opens the drawer runs the agent.
 *
 * One `resolve` call per agent, with `parameters` built from the configuration on screen, so an
 * item switched to "each person" and not saved yet still gets its line. The drawers of one agent
 * share the call: its key holds only the agent's "user" items.
 */
import {useMemo} from "react"

import {
    draftItemAccountsFamilyKey,
    draftItemAccountsQueryAtomFamily,
    type ItemAccount,
} from "@agenta/entities/accountChoice"
import {workflowMolecule} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

/** Where an item's drawer is: the saved revision on screen and the agent template it edits. */
export interface ItemAccountContext {
    revisionId: string | null
    /** The agent, when the host already knows it; otherwise read from the revision. */
    workflowId?: string
    /** The agent template on screen (`parameters.agent`), saved or not. */
    agent: Record<string, unknown>
}

export interface ItemAccountState {
    /** The agent, for an account choice. Empty until the revision is known. */
    workflowId: string
    account: ItemAccount | undefined
    loading: boolean
    /** The read failed. The line is left out: a person sees no technical error. */
    failed: boolean
}

export const useItemAccount = (
    context: ItemAccountContext | undefined,
    itemKey: string,
): ItemAccountState => {
    const fromRevision = useAtomValue(
        workflowMolecule.selectors.workflowId(
            context?.workflowId ? "" : (context?.revisionId ?? ""),
        ),
    )
    const workflowId = context?.workflowId || fromRevision || ""
    const key = useMemo(
        () => (context ? draftItemAccountsFamilyKey(workflowId, context.agent) : ""),
        [context, workflowId],
    )
    const query = useAtomValue(draftItemAccountsQueryAtomFamily(key))
    return {
        workflowId,
        account: query.data?.find((item) => item.item_key === itemKey),
        loading: Boolean(key) && query.isPending,
        failed: query.isError,
    }
}
