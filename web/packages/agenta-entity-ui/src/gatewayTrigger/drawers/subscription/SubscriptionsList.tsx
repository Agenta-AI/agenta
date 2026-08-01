/** The subscription drawer's master-detail left rail. */
import {
    getScheduleMessagePreview,
    isEntityActive,
    type TriggerSubscription,
} from "@agenta/entities/gatewayTrigger"
import {Modal} from "antd"

import {
    DraftListRow,
    EntityListRow,
    MasterDetailRail,
} from "../../../drawers/shared/MasterDetailRail"

// ---------------------------------------------------------------------------
// SubscriptionsList — master-detail left rail (reuses MasterDetailRail).
// ---------------------------------------------------------------------------

export function SubscriptionsList({
    selectedId,
    onSelect,
    onNew,
    drafts,
    draftNames,
    canCreate,
    subscriptions,
    isLoading,
    onRemoveDraft,
    onDeleteSubscription,
}: {
    selectedId?: string
    onSelect: (id?: string) => void
    onNew: () => void
    drafts: string[]
    draftNames: Record<string, string>
    canCreate: boolean
    subscriptions: TriggerSubscription[]
    isLoading: boolean
    onRemoveDraft: (id: string) => void
    onDeleteSubscription: (id: string) => void
}) {
    const [modal, modalContextHolder] = Modal.useModal()

    const confirmRemoveDraft = (draftId: string, name: string) =>
        modal.confirm({
            title: "Discard draft?",
            content: name.trim()
                ? `"${name.trim()}" hasn't been saved. Discard it?`
                : "This draft hasn't been saved.",
            okText: "Discard",
            okButtonProps: {danger: true},
            cancelText: "Cancel",
            onOk: () => onRemoveDraft(draftId),
        })

    const confirmDelete = (subscription: TriggerSubscription) =>
        modal.confirm({
            title: "Delete trigger?",
            content: `This permanently deletes ${subscription.name ? `"${subscription.name}"` : "this trigger"}.`,
            okText: "Delete",
            okButtonProps: {danger: true},
            cancelText: "Cancel",
            onOk: () => subscription.id && onDeleteSubscription(subscription.id),
        })

    return (
        <MasterDetailRail
            newLabel="New trigger"
            onNew={onNew}
            canCreate={canCreate}
            isLoading={isLoading}
            isEmpty={subscriptions.length === 0 && drafts.length === 0}
            emptyText="No triggers yet."
        >
            {modalContextHolder}
            {drafts.map((draftId) => (
                <DraftListRow
                    key={draftId}
                    active={selectedId === draftId}
                    name={draftNames[draftId] ?? ""}
                    draftLabel="Untitled trigger"
                    onClick={() => onSelect(draftId)}
                    onRemove={() => confirmRemoveDraft(draftId, draftNames[draftId] ?? "")}
                />
            ))}
            {subscriptions.map((s) => {
                const named = !!s.name?.trim()
                const message = getScheduleMessagePreview(s.data?.inputs_fields)
                return (
                    <EntityListRow
                        key={s.id}
                        active={!!s.id && s.id === selectedId}
                        running={isEntityActive(s)}
                        title={named ? (s.name as string) : "Untitled trigger"}
                        titleMuted={!named}
                        subtitle={s.data?.event_key || message || "App subscription"}
                        onClick={() => onSelect(s.id ?? undefined)}
                        onRemove={s.id ? () => confirmDelete(s) : undefined}
                    />
                )
            })}
        </MasterDetailRail>
    )
}
