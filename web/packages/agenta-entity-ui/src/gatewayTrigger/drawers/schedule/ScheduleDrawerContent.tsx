/** The schedule drawer's body: data fetching + master-detail wiring, mounted only while open. */
import {useCallback, useMemo} from "react"

import {
    useTriggerSchedule,
    useTriggerSchedules,
    type ScheduleDrawerState,
} from "@agenta/entities/gatewayTrigger"
import {workflowMolecule} from "@agenta/entities/workflow"
import {message} from "@agenta/ui"
import {useAtomValue} from "jotai"

import {isDraftId} from "../../../drawers/shared/MasterDetailRail"
import {useDraftMasterDetail} from "../../../drawers/shared/useDraftMasterDetail"

import {MAX_DRAFTS, SHOW_LIST_RAIL} from "./constants"
import {ScheduleForm} from "./ScheduleForm"
import {SchedulesList} from "./SchedulesList"

// ---------------------------------------------------------------------------
// ScheduleDrawerContent — the playground's master-detail body (list + per-draft
// forms) and the data fetching it needs. Rendered only while the drawer is open
// AND only in a playground, so the schedules list query, per-schedule detail
// queries, and draft state never run for the settings single-form drawer.
// ---------------------------------------------------------------------------

export function ScheduleDrawerContent({
    state,
    playgroundEntityId,
    onClose,
}: {
    state: ScheduleDrawerState
    playgroundEntityId: string
    onClose: () => void
}) {
    const {schedules: allSchedules, isLoading: schedulesLoading} = useTriggerSchedules()
    const {remove: deleteScheduleApi} = useTriggerSchedule()

    // Scope the list to schedules linked to this agent's WORKFLOW — matched by the workflow
    // id (not a specific variant or revision), plus the app slug so environment-bound
    // schedules (which reference the app by slug) still match.
    const playgroundData = useAtomValue(workflowMolecule.selectors.data(playgroundEntityId))
    const schedules = useMemo(() => {
        const workflowId = playgroundData?.workflow_id ?? playgroundEntityId
        const appSlug = (playgroundData as {slug?: string} | null)?.slug
        return allSchedules.filter((s) => {
            const refs = s.data?.references
            if (!refs) return false
            return Object.values(refs).some(
                (r) => (!!r?.id && r.id === workflowId) || (!!appSlug && r?.slug === appSlug),
            )
        })
    }, [allSchedules, playgroundEntityId, playgroundData])

    const onDeleteSchedule = useCallback(
        async (scheduleId: string): Promise<boolean> => {
            try {
                await deleteScheduleApi(scheduleId)
            } catch {
                message.error("Failed to delete schedule")
                return false
            }
            message.success("Schedule deleted")
            return true
        },
        [deleteScheduleApi],
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
        initialId: state.scheduleId,
        entities: schedules,
        maxDrafts: MAX_DRAFTS,
        onDelete: onDeleteSchedule,
    })

    return (
        <div className="flex h-full min-h-0 w-full overflow-hidden">
            {SHOW_LIST_RAIL && (
                <SchedulesList
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onNew={handleNew}
                    drafts={drafts}
                    draftNames={draftNames}
                    canCreate={canCreate}
                    schedules={schedules}
                    isLoading={schedulesLoading}
                    onRemoveDraft={removeDraft}
                    onDeleteSchedule={deleteEntity}
                />
            )}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                {/* Each draft form stays mounted (hidden unless selected) so its
                    in-progress values persist while the user works on others. */}
                {drafts.map((draftId) => (
                    <ScheduleForm
                        key={draftId}
                        scheduleId={undefined}
                        onClose={onClose}
                        hidden={selectedId !== draftId}
                        onNameChange={(name) => setDraftName(draftId, name)}
                        onSaved={(savedId) => handleDraftSaved(draftId, savedId)}
                    />
                ))}
                {selectedId && !isDraftId(selectedId) && (
                    <ScheduleForm
                        key={selectedId}
                        scheduleId={selectedId}
                        onClose={onClose}
                        onSaved={setSelectedId}
                    />
                )}
            </div>
        </div>
    )
}
