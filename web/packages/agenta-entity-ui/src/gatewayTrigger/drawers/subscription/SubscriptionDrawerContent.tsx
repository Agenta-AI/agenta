/** The subscription drawer's body: data fetching + master-detail wiring, mounted only while open. */
import {useCallback, useEffect, useMemo} from "react"

import {
    useTriggerSubscription,
    useTriggerSubscriptions,
    type SubscriptionDrawerState,
} from "@agenta/entities/gatewayTrigger"
import {workflowMolecule} from "@agenta/entities/workflow"
import {message} from "@agenta/ui"
import {useAtomValue, useSetAtom} from "jotai"

import {isDraftId} from "../../../drawers/shared/MasterDetailRail"
import {useDraftMasterDetail} from "../../../drawers/shared/useDraftMasterDetail"

import {MAX_DRAFTS, SHOW_LIST_RAIL, subscriptionEditingAtom} from "./constants"
import {SubscriptionForm} from "./SubscriptionForm"
import {SubscriptionsList} from "./SubscriptionsList"

// ---------------------------------------------------------------------------
// SubscriptionDrawerContent — the playground's master-detail body and the data
// fetching it needs, mounted only while open (settings renders the bare form).
// ---------------------------------------------------------------------------

export function SubscriptionDrawerContent({
    state,
    playgroundEntityId,
    onClose,
}: {
    state: SubscriptionDrawerState
    playgroundEntityId: string
    onClose: () => void
}) {
    const {subscriptions: allSubscriptions, isLoading: subsLoading} = useTriggerSubscriptions()
    const {remove: deleteSubscriptionApi} = useTriggerSubscription()

    // Scope the list to subscriptions linked to this agent's WORKFLOW (id + app slug).
    const playgroundData = useAtomValue(workflowMolecule.selectors.data(playgroundEntityId))
    const subscriptions = useMemo(() => {
        const workflowId = playgroundData?.workflow_id ?? playgroundEntityId
        const appSlug = (playgroundData as {slug?: string} | null)?.slug
        return allSubscriptions.filter((s) => {
            const refs = s.data?.references
            if (!refs) return false
            return Object.values(refs).some(
                (r) => (!!r?.id && r.id === workflowId) || (!!appSlug && r?.slug === appSlug),
            )
        })
    }, [allSubscriptions, playgroundEntityId, playgroundData])

    const onDeleteSubscription = useCallback(
        async (subscriptionId: string): Promise<boolean> => {
            try {
                await deleteSubscriptionApi(subscriptionId)
            } catch {
                message.error("Failed to delete trigger")
                return false
            }
            message.success("Trigger deleted")
            return true
        },
        [deleteSubscriptionApi],
    )

    const {
        selectedId,
        setSelectedId,
        drafts,
        draftNames,
        canCreate,
        handleNew,
        setDraftName,
        handleDraftSaved,
        removeDraft,
        deleteEntity,
    } = useDraftMasterDetail({
        initialId: state.subscriptionId,
        entities: subscriptions,
        maxDrafts: MAX_DRAFTS,
        onDelete: onDeleteSubscription,
    })

    // Publish whether the open form is a saved subscription so the root title reflects it
    // (after a create, selectedId switches to the saved id while state.subscriptionId stays unset).
    const setEditing = useSetAtom(subscriptionEditingAtom)
    useEffect(() => {
        setEditing(!!selectedId && !isDraftId(selectedId))
        return () => setEditing(false)
    }, [selectedId, setEditing])

    return (
        <div className="flex h-full min-h-0 w-full overflow-hidden">
            {SHOW_LIST_RAIL && (
                <SubscriptionsList
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onNew={handleNew}
                    drafts={drafts}
                    draftNames={draftNames}
                    canCreate={canCreate}
                    subscriptions={subscriptions}
                    isLoading={subsLoading}
                    onRemoveDraft={removeDraft}
                    onDeleteSubscription={deleteEntity}
                />
            )}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {drafts.map((draftId) => (
                    <SubscriptionForm
                        key={draftId}
                        subscriptionId={undefined}
                        onClose={onClose}
                        hidden={selectedId !== draftId}
                        onNameChange={(name) => setDraftName(draftId, name)}
                        onSaved={(savedId) => handleDraftSaved(draftId, savedId)}
                    />
                ))}
                {selectedId && !isDraftId(selectedId) && (
                    <SubscriptionForm
                        key={selectedId}
                        subscriptionId={selectedId}
                        onClose={onClose}
                        onSaved={setSelectedId}
                    />
                )}
            </div>
        </div>
    )
}
