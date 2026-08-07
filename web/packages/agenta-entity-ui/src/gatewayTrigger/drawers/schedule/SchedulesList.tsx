/** The schedule drawer's master-detail left rail. */
import {describeCron, isEntityActive, type TriggerSchedule} from "@agenta/entities/gatewayTrigger"
import {modal} from "@agenta/ui"

import {
    DraftListRow,
    EntityListRow,
    MasterDetailRail,
} from "../../../drawers/shared/MasterDetailRail"

// ---------------------------------------------------------------------------
// SchedulesList — the master-detail left panel: existing schedules plus a
// "New schedule" entry. Selecting a row loads it into the config on the right.
// ---------------------------------------------------------------------------

export function SchedulesList({
    selectedId,
    onSelect,
    onNew,
    drafts,
    draftNames,
    canCreate,
    schedules,
    isLoading,
    onRemoveDraft,
    onDeleteSchedule,
}: {
    selectedId?: string
    onSelect: (id?: string) => void
    onNew: () => void
    drafts: string[]
    draftNames: Record<string, string>
    canCreate: boolean
    schedules: TriggerSchedule[]
    isLoading: boolean
    onRemoveDraft: (id: string) => void
    onDeleteSchedule: (id: string) => void
}) {
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

    const confirmDeleteSchedule = (schedule: TriggerSchedule) =>
        modal.confirm({
            title: "Delete schedule?",
            content: `This permanently deletes ${schedule.name ? `"${schedule.name}"` : "this schedule"}.`,
            okText: "Delete",
            okButtonProps: {danger: true},
            cancelText: "Cancel",
            onOk: () => schedule.id && onDeleteSchedule(schedule.id),
        })

    return (
        <MasterDetailRail
            newLabel="New schedule"
            onNew={onNew}
            canCreate={canCreate}
            isLoading={isLoading}
            isEmpty={schedules.length === 0 && drafts.length === 0}
            emptyText="No schedules yet."
        >
            {/* One row per unsaved draft slot; each persists its own form state. */}
            {drafts.map((draftId) => (
                <DraftListRow
                    key={draftId}
                    active={selectedId === draftId}
                    name={draftNames[draftId] ?? ""}
                    draftLabel="Untitled schedule"
                    onClick={() => onSelect(draftId)}
                    onRemove={() => confirmRemoveDraft(draftId, draftNames[draftId] ?? "")}
                />
            ))}
            {schedules.map((s) => (
                <EntityListRow
                    key={s.id}
                    active={!!s.id && s.id === selectedId}
                    running={isEntityActive(s)}
                    title={s.name || "Untitled schedule"}
                    subtitle={describeCron(s.data?.schedule ?? "")}
                    onClick={() => onSelect(s.id ?? undefined)}
                    onRemove={s.id ? () => confirmDeleteSchedule(s) : undefined}
                />
            ))}
        </MasterDetailRail>
    )
}
