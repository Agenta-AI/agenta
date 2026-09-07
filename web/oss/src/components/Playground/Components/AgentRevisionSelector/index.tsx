import {useEffect} from "react"

import {isLocalDraftId} from "@agenta/entities/shared"
import {workflowMolecule} from "@agenta/entities/workflow"
import {registerAgentAutoCommitHandler} from "@agenta/playground/state"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {useAtomValue} from "jotai"

import {useCommitHostAdapter} from "../Modals/CommitVariantChangesModal/assets/useCommitHostAdapter"

/**
 * The agent playground's header control — a `v{n} ⌄ ● Draft/Saved` chip that opens version
 * history. Variant-scoped: it derives everything from `variantId`, so it stays in sync wherever
 * it's rendered.
 *
 * No variant picker: an agent is edited as one thing, and the picker that used to sit here offered
 * variant switching the agent surface has no use for. Other workflow kinds keep `SelectVariant` in
 * the playground header.
 *
 * The `vN` chip IS the drawer trigger — a separate "Versions" button beside it said the same
 * thing twice. Mobile's bar works the same way.
 */
const AgentRevisionSelector = ({variantId}: {variantId: string}) => {
    const runnableData = useAtomValue(workflowMolecule.selectors.data(variantId || ""))
    const isLocalDraftVariant = variantId ? isLocalDraftId(variantId) : false
    const workflowId = runnableData?.workflow_id ?? null

    // An auto-commit is still a commit, so it owes this app the same out-of-band work a manual
    // one did: the registry and evaluator tables live outside the entities layer and go stale
    // otherwise. The agent header no longer carries the adapter (it has no Commit button to hang
    // it on), so the reaction hangs off the engine instead.
    const {onAfterCommit, onCommitted} = useCommitHostAdapter()
    useEffect(
        () =>
            registerAgentAutoCommitHandler("agent-revision-selector", () => {
                onAfterCommit()
                onCommitted()
            }),
        [onAfterCommit, onCommitted],
    )

    if (!variantId || isLocalDraftVariant) return null

    return <AgentRevisionStatus revisionId={variantId} historyWorkflowId={workflowId} />
}

export default AgentRevisionSelector
