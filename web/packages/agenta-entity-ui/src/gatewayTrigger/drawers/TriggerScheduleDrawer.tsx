import {useCallback, useEffect, useMemo, useState, type ReactNode} from "react"

import {
    appEnvironmentsQueryAtomFamily,
    environmentsListQueryAtomFamily,
} from "@agenta/entities/environment"
import {
    describeCron,
    getScheduleMessage,
    isEntityActive,
    localFaceToUtcIso,
    setScheduleMessage,
    triggerApiErrorMessage,
    triggerScheduleDrawerAtom,
    useTriggerSchedule,
    useTriggerSchedules,
    utcIsoToLocalFace,
    validateCron,
    type ScheduleDrawerState,
    type TriggerSchedule,
    type TriggerScheduleCreate,
    type TriggerScheduleData,
    type TriggerScheduleEdit,
} from "@agenta/entities/gatewayTrigger"
import {extractInputPortsFromSchema} from "@agenta/entities/runnable"
import {appWorkflowsListQueryStateAtom, workflowMolecule} from "@agenta/entities/workflow"
import {simulatedAgentRunAtomFamily} from "@agenta/shared/state"
import {dayjs} from "@agenta/shared/utils"
import {message} from "@agenta/ui"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Editor} from "@agenta/ui/editor"
import {CalendarBlank, ChatText, Clock, GitBranch, Play, Tag} from "@phosphor-icons/react"
import {Button, DatePicker, Form, Input, Modal, Popover, Spin, Tooltip, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {createWorkflowRevisionAdapter, type WorkflowRevisionSelectionResult} from "../../selection"

import {ScheduleBuilderField} from "./ScheduleBuilderField"
import {RunVersionField, buildRunVersionReferences} from "./shared/RunVersionField"
import {TriggerDrawerFooter} from "./shared/TriggerDrawerFooter"
import {DraftListRow, EntityListRow, TriggerListRail, isDraftId} from "./shared/TriggerListRail"
import {useDraftMasterDetail} from "./shared/useDraftMasterDetail"

// Weekly (Monday 09:00 UTC) so the builder opens on the Weekly cadence by default.
const DEFAULT_CRON = "0 9 * * 1"
// How many unsaved drafts can exist at once. Set to 1 for single-draft behavior
// (the "New schedule" button disables while a draft is active); raise for multiple
// staged drafts. Purely a config knob — no other logic depends on the value.
const MAX_DRAFTS = 5
// Show the master-detail list rail (existing schedules + "New schedule"). Hidden for now —
// the playground opens straight to a single form; flip back to true to restore the list.
const SHOW_LIST_RAIL = false
// A schedule fires a synthetic tick; there is no provider event, but the data
// model still requires an `event_key`. We use a stable schedule-tick key.
const SCHEDULE_EVENT_KEY = "schedule.tick"

// Schedules bind the `application_*` reference family (same as subscriptions),
// so the picker only offers application workflows (is_application=True).
const applicationRevisionAdapter = createWorkflowRevisionAdapter({
    workflowListAtom: appWorkflowsListQueryStateAtom,
})

// Section title with a trailing required marker (icon → text → required).
function RequiredTitle({children}: {children: ReactNode}) {
    return (
        <>
            {children}
            <span className="ml-1 text-[var(--ag-colorError)]">*</span>
        </>
    )
}

// Compact a JSON string for stable comparison (so formatting doesn't count as a
// change when computing the dirty state).
function normalizeJson(text: string): string {
    try {
        return JSON.stringify(JSON.parse(text))
    } catch {
        return text
    }
}

// ---------------------------------------------------------------------------
// TriggerScheduleDrawer (root) — create or edit a schedule.
//
// Binds a recurring UTC cron tick to a workflow revision. Edits are full-PUT:
// the body is sourced from the freshly-fetched schedule and only owned fields
// are overridden. From a playground it's a master-detail manager: existing
// schedules on the left, the config on the right, a persistent "Run in
// playground" in the footer. From settings (no playground) it stays a single
// create/edit form, since that page already lists schedules.
// ---------------------------------------------------------------------------

export default function TriggerScheduleDrawer() {
    const [state, setState] = useAtom(triggerScheduleDrawerAtom)
    const open = !!state
    const handleClose = useCallback(() => setState(null), [setState])

    const playgroundEntityId = state?.playgroundEntityId
    const title =
        SHOW_LIST_RAIL && playgroundEntityId
            ? "Schedules"
            : state?.scheduleId
              ? "Edit schedule"
              : "New schedule"

    // EnhancedDrawer renders nothing until first open and unmounts after close, so the
    // content below — which owns all data fetching and master-detail state — only mounts
    // (and its hooks only run) while the drawer is open. The lifecycle is structural; no
    // `enabled` flags or render guards are needed.
    return (
        <EnhancedDrawer
            open={open}
            onClose={handleClose}
            title={title}
            width={playgroundEntityId ? 960 : 640}
            closeOnLayoutClick={false}
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            {state && <ScheduleDrawerContent state={state} onClose={handleClose} />}
        </EnhancedDrawer>
    )
}

// ---------------------------------------------------------------------------
// ScheduleDrawerContent — the drawer's data fetching and master-detail business
// logic. Rendered only while the drawer is open (see above), so the schedules
// list query, per-schedule detail queries, and draft state never run in the
// background. Playground = master-detail; settings = a single create/edit form.
// ---------------------------------------------------------------------------

function ScheduleDrawerContent({
    state,
    onClose,
}: {
    state: ScheduleDrawerState
    onClose: () => void
}) {
    const playgroundEntityId = state.playgroundEntityId

    const {schedules: allSchedules, isLoading: schedulesLoading} = useTriggerSchedules()
    const {remove: deleteScheduleApi} = useTriggerSchedule()

    // In a playground, scope the list to schedules linked to this agent's WORKFLOW —
    // matched by the workflow id (not a specific variant or revision), plus the app
    // slug so environment-bound schedules (which reference the app by slug) still match.
    const playgroundData = useAtomValue(workflowMolecule.selectors.data(playgroundEntityId ?? ""))
    const schedules = useMemo(() => {
        if (!playgroundEntityId) return allSchedules
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

    if (!playgroundEntityId) {
        return (
            <ScheduleForm
                key={state.scheduleId ?? "new"}
                scheduleId={state.scheduleId}
                onClose={onClose}
            />
        )
    }

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

// ---------------------------------------------------------------------------
// SchedulesList — the master-detail left panel: existing schedules plus a
// "New schedule" entry. Selecting a row loads it into the config on the right.
// ---------------------------------------------------------------------------

function SchedulesList({
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
    // Use the hook form so the confirm renders inside the theme context (static
    // Modal.confirm escapes ConfigProvider and renders unstyled in dark mode).
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
        <TriggerListRail
            newLabel="New schedule"
            onNew={onNew}
            canCreate={canCreate}
            isLoading={isLoading}
            isEmpty={schedules.length === 0 && drafts.length === 0}
            emptyText="No schedules yet."
        >
            {modalContextHolder}
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
        </TriggerListRail>
    )
}

// ---------------------------------------------------------------------------
// Schedule form
// ---------------------------------------------------------------------------

function ScheduleForm({
    scheduleId,
    onClose,
    hidden,
    onNameChange,
    onSaved,
}: {
    scheduleId?: string
    onClose: () => void
    hidden?: boolean
    onNameChange?: (name: string) => void
    // Called with the saved schedule's id on success. When provided the drawer stays
    // open (master-detail); otherwise the form closes the drawer (settings).
    onSaved?: (savedId: string) => void
}) {
    const [state] = useAtom(triggerScheduleDrawerAtom)
    const isEdit = !!scheduleId
    const playgroundEntityId = state?.playgroundEntityId

    const {
        schedule,
        isLoading: scheduleLoading,
        isMutating,
        create,
        edit,
    } = useTriggerSchedule(scheduleId)

    const [name, setName] = useState("")
    const [cron, setCron] = useState(DEFAULT_CRON)
    const [startTime, setStartTime] = useState<string | null>(null)
    const [endTime, setEndTime] = useState<string | null>(null)
    const [enabled, setEnabled] = useState(true)
    const [workflowRevId, setWorkflowRevId] = useState<string | null>(null)
    const [workflowSelection, setWorkflowSelection] =
        useState<WorkflowRevisionSelectionResult | null>(null)
    const [workflowLabel, setWorkflowLabel] = useState<string | null>(null)
    const [inputsText, setInputsText] = useState("{}")

    // Run agent version: bind to a specific revision (the picker) or to an
    // environment (always runs whatever is deployed there).
    const [bindMode, setBindMode] = useState<"revision" | "environment">("revision")
    const [environmentSlug, setEnvironmentSlug] = useState<string | null>(null)
    const [appSlug, setAppSlug] = useState<string | null>(null)
    const envQuery = useAtomValue(environmentsListQueryAtomFamily(false))
    const environments = envQuery.data?.environments ?? []

    // Resolve the bound revision id to a human label (edit-mode prefill stores only
    // the id) — app name / variant name · vN. These are sync atoms (null for unknown).
    const resolvedArtifact = useAtomValue(
        workflowMolecule.selectors.artifactName(workflowRevId ?? ""),
    )
    const resolvedVariant = useAtomValue(
        workflowMolecule.selectors.variantLabel(workflowRevId ?? ""),
    )
    const resolvedRevData = useAtomValue(workflowMolecule.selectors.data(workflowRevId ?? ""))
    const resolvedRevisionName = useMemo(() => {
        if (!workflowRevId) return null
        const segs: string[] = []
        if (resolvedArtifact) segs.push(resolvedArtifact)
        if (resolvedVariant && resolvedVariant !== resolvedArtifact) segs.push(resolvedVariant)
        let label = segs.join(" / ")
        const version = resolvedRevData?.version
        if (version != null) label = label ? `${label} · v${version}` : `v${version}`
        return label || null
    }, [workflowRevId, resolvedArtifact, resolvedVariant, resolvedRevData?.version])

    // In a playground the workflow is already known (the agent), so scope the picker
    // to that workflow — pick a variant + revision, not an arbitrary workflow. In
    // settings (no playground) keep the full workflow → variant → revision picker.
    const playgroundWorkflow = useAtomValue(
        workflowMolecule.selectors.data(playgroundEntityId ?? ""),
    )
    // The agent's app name — the scoped picker's leaf label omits it, so we prepend it.
    const playgroundAppName = useAtomValue(
        workflowMolecule.selectors.artifactName(playgroundEntityId ?? ""),
    )
    const revisionAdapter = useMemo(() => {
        if (!playgroundEntityId) return applicationRevisionAdapter
        return createWorkflowRevisionAdapter({
            workflowId: playgroundWorkflow?.workflow_id ?? playgroundEntityId,
            excludeRevisionZero: true,
            parentLabel: "Variant",
        })
    }, [playgroundEntityId, playgroundWorkflow?.workflow_id])

    // Environment options: in a playground, scope to the environments this agent is
    // actually deployed to (not every project environment); settings lists them all.
    const appIdForEnv = playgroundEntityId
        ? (playgroundWorkflow?.workflow_id ?? playgroundEntityId)
        : ""
    const appDeployments = useAtomValue(appEnvironmentsQueryAtomFamily(appIdForEnv))
    const envOptions = useMemo<{value: string; label: string}[]>(() => {
        if (!playgroundEntityId) {
            return environments.map((e) => ({value: e.slug ?? "", label: e.name || e.slug || ""}))
        }
        return (appDeployments.data ?? [])
            .filter((d) => d.deployedRevisionId || d.deployedVariantId)
            .map((d) => ({
                value: d.slug ?? "",
                label:
                    d.deployedVariantName && d.revision
                        ? `${d.name} · ${d.deployedVariantName} v${d.revision}`
                        : (d.name ?? d.slug ?? ""),
            }))
    }, [playgroundEntityId, environments, appDeployments.data])

    // Prefill from the freshly-fetched schedule (edit mode).
    useEffect(() => {
        if (!isEdit || !schedule) return
        setName(schedule.name ?? "")
        setCron(schedule.data?.schedule ?? DEFAULT_CRON)
        setStartTime(schedule.data?.start_time ?? null)
        setEndTime(schedule.data?.end_time ?? null)
        setEnabled(isEntityActive(schedule))
        const refs = schedule.data?.references
        const envRef = refs?.environment
        if (envRef) {
            setBindMode("environment")
            setEnvironmentSlug(envRef.slug ?? null)
            setAppSlug(refs?.application?.slug ?? null)
        } else {
            const wfId =
                refs?.application_revision?.id ??
                refs?.application_variant?.id ??
                refs?.workflow_revision?.id ??
                null
            setWorkflowRevId(wfId)
            // Label is resolved from the revision id below, not stored as the raw id.
        }
        setInputsText(JSON.stringify(schedule.data?.inputs_fields ?? {}, null, 2))
    }, [isEdit, schedule])

    // Create-mode default-bind: when opened with `defaultReferences` (e.g. from an
    // agent's config panel), pre-bind the new schedule to that workflow so the user
    // doesn't have to re-pick it. Seed `workflowRevId` from the variant ref and, when
    // present, the workflow (app) id via the selection metadata so `handleSubmit`
    // emits the same `{application, application_variant}` shape a fresh pick would.
    useEffect(() => {
        if (isEdit) return
        const refs = state?.defaultReferences
        setAppSlug(refs?.application?.slug ?? null)
        const variantId = refs?.application_variant?.id ?? refs?.application_revision?.id ?? null
        if (!variantId) return
        const appId = refs?.application?.id ?? null
        const label = state?.defaultBoundLabel ?? appId ?? variantId
        setWorkflowRevId(variantId)
        setWorkflowLabel(label)
        setWorkflowSelection({
            type: "workflowRevision",
            id: variantId,
            label,
            path: [],
            metadata: {
                workflowId: appId ?? "",
                workflowName: state?.defaultBoundLabel ?? "",
                variantId,
                variantName: "",
                revision: 0,
            },
        })
        // Run once per open; `state` is keyed so the form remounts per drawer open.
    }, [isEdit])

    const cronValidation = useMemo(() => validateCron(cron), [cron])

    // Save enables only on draft changes vs the starting point (loaded schedule in
    // edit, defaults in new). Normalized JSON so formatting isn't a change.
    const baselineSnapshot = useMemo(() => {
        if (isEdit && schedule) {
            const refs = schedule.data?.references
            const envRef = refs?.environment
            return JSON.stringify({
                name: schedule.name ?? "",
                cron: schedule.data?.schedule ?? DEFAULT_CRON,
                startTime: schedule.data?.start_time ?? null,
                endTime: schedule.data?.end_time ?? null,
                enabled: isEntityActive(schedule),
                bindMode: envRef ? "environment" : "revision",
                environmentSlug: envRef?.slug ?? null,
                workflowRevId:
                    refs?.application_revision?.id ??
                    refs?.application_variant?.id ??
                    refs?.workflow_revision?.id ??
                    null,
                inputs: normalizeJson(JSON.stringify(schedule.data?.inputs_fields ?? {})),
            })
        }
        // New mode: the baseline includes the default-bound workflow (set by the
        // prefill effect) so pre-binding to the agent isn't counted as a change.
        const refs = state?.defaultReferences
        return JSON.stringify({
            name: "",
            cron: DEFAULT_CRON,
            startTime: null,
            endTime: null,
            enabled: true,
            bindMode: "revision",
            environmentSlug: null,
            workflowRevId: refs?.application_variant?.id ?? refs?.application_revision?.id ?? null,
            inputs: normalizeJson("{}"),
        })
    }, [isEdit, schedule, state?.defaultReferences])

    const isDirty = useMemo(
        () =>
            baselineSnapshot !==
            JSON.stringify({
                name,
                cron,
                startTime,
                endTime,
                enabled,
                bindMode,
                environmentSlug: environmentSlug ?? null,
                workflowRevId: workflowRevId ?? null,
                inputs: normalizeJson(inputsText),
            }),
        [
            baselineSnapshot,
            name,
            cron,
            startTime,
            endTime,
            enabled,
            bindMode,
            environmentSlug,
            workflowRevId,
            inputsText,
        ],
    )

    const handleSubmit = useCallback(async () => {
        if (!cronValidation.valid) {
            message.error(cronValidation.error ?? "Invalid cron expression")
            return
        }
        if (bindMode === "environment" && !environmentSlug) {
            message.error("Select an environment")
            return
        }
        if (bindMode === "revision" && !workflowRevId) {
            message.error("Bind a workflow")
            return
        }
        if (startTime && endTime && !dayjs.utc(endTime).isAfter(dayjs.utc(startTime))) {
            message.error("End time must be after start time")
            return
        }

        let inputsFields: Record<string, unknown> = {}
        try {
            inputsFields = inputsText.trim() ? JSON.parse(inputsText) : {}
        } catch {
            message.error("inputs mapping is not valid JSON")
            return
        }

        // On a fresh pick, send the application family by the picker's ids. The
        // scoped (playground) picker's leaf is a specific REVISION → bind via
        // `application_revision`; otherwise it's a variant (latest) →
        // `application_variant`. Without a re-pick (edit), resend the stored
        // already-complete references. The BE completes the family either way.
        const references = buildRunVersionReferences({
            bindMode,
            environmentSlug,
            appSlug,
            workflowSelection,
            workflowRevId,
            fallbackReferences: schedule?.data?.references,
        })

        const data: TriggerScheduleData = {
            event_key: schedule?.data?.event_key ?? SCHEDULE_EVENT_KEY,
            schedule: cron.trim(),
            start_time: startTime,
            end_time: endTime,
            inputs_fields: inputsFields,
            references,
        }

        try {
            let savedId: string | null = null
            if (isEdit && schedule) {
                // Full PUT — carry the whole entity, override owned fields.
                const body: TriggerScheduleEdit = {
                    id: schedule.id as string,
                    name: name || null,
                    description: schedule.description ?? null,
                    tags: schedule.tags ?? null,
                    meta: schedule.meta ?? null,
                    data: {...schedule.data, ...data},
                    flags: {...(schedule.flags ?? {}), is_active: enabled},
                }
                const result = await edit(body)
                if (!result) {
                    message.error("Failed to update schedule")
                    return
                }
                savedId = result.id ?? null
                message.success("Schedule updated")
            } else {
                const body: TriggerScheduleCreate = {
                    name: name || null,
                    data,
                }
                const result = await create(body)
                if (!result) {
                    message.error("Failed to create schedule")
                    return
                }
                savedId = result.id ?? null
                message.success("Schedule created")
            }
            // Master-detail keeps the drawer open on the saved schedule; the single-form
            // (settings) drawer closes.
            if (onSaved && savedId) onSaved(savedId)
            else onClose()
        } catch (error) {
            message.error(triggerApiErrorMessage(error, "Failed to save schedule"))
        }
    }, [
        cronValidation,
        cron,
        startTime,
        endTime,
        bindMode,
        environmentSlug,
        appSlug,
        workflowRevId,
        workflowSelection,
        inputsText,
        isEdit,
        schedule,
        name,
        enabled,
        edit,
        create,
        onClose,
        onSaved,
    ])

    // Per-section header state: icon tint (complete / warning / default) and a
    // collapsed summary of what's configured.
    const cronValid = cronValidation.valid
    const versionChosen = bindMode === "revision" ? !!workflowRevId : !!environmentSlug
    const versionSummary =
        bindMode === "revision"
            ? (workflowLabel ?? resolvedRevisionName ?? undefined)
            : environmentSlug
              ? `env: ${environmentSlug}`
              : undefined
    const windowSet = !!startTime || !!endTime
    const windowSummary = windowSet
        ? `${startTime ? startTime.slice(0, 10) : "open"} → ${endTime ? endTime.slice(0, 10) : "open"}`
        : undefined
    // What shape do the bound app's inputs take? `executionMode` is the runtime's own
    // split: "chat" when the app takes a `messages` array (agents carry is_chat, and
    // chat apps either set it or declare `messages` in their input schema), else
    // "completion" (flat named inputs). The composer writes to `messages` for chat, or
    // the first string input from the schema (fallback "message") for completion.
    const schemaSourceId = playgroundEntityId ?? workflowRevId ?? ""
    const isChatInput =
        useAtomValue(workflowMolecule.selectors.executionMode(schemaSourceId)) === "chat"
    const agentInputSchema = useAtomValue(workflowMolecule.selectors.inputSchema(schemaSourceId))
    const primaryInputKey = useMemo(() => {
        if (isChatInput) return "messages"
        const ports = extractInputPortsFromSchema(agentInputSchema)
        return ports.find((p) => p.type === "string")?.key ?? "message"
    }, [isChatInput, agentInputSchema])
    const composedMessage = useMemo(
        () => getScheduleMessage(inputsText, isChatInput, primaryInputKey),
        [inputsText, isChatInput, primaryInputKey],
    )
    const messageStatus = composedMessage.trim() ? "complete" : "default"

    if (isEdit && scheduleLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spin />
            </div>
        )
    }

    return (
        <div
            className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden${
                hidden ? " hidden" : ""
            }`}
        >
            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
                <Form layout="vertical">
                    <ConfigAccordionSection
                        size="compact"
                        collapsible={false}
                        icon={<Tag size={15} />}
                        title="Name"
                        status={name.trim() ? "complete" : "default"}
                    >
                        <Input
                            placeholder="Schedule name"
                            value={name}
                            onChange={(e) => {
                                setName(e.target.value)
                                onNameChange?.(e.target.value)
                            }}
                        />
                    </ConfigAccordionSection>

                    <ConfigAccordionSection
                        size="compact"
                        icon={<Clock size={15} />}
                        title={<RequiredTitle>When should it run?</RequiredTitle>}
                        status={cronValid ? "complete" : "warning"}
                        summary={cronValid ? describeCron(cron) : undefined}
                        summaryCollapsedOnly
                    >
                        <ScheduleBuilderField value={cron} onChange={setCron} />
                    </ConfigAccordionSection>

                    <ConfigAccordionSection
                        size="compact"
                        defaultOpen={false}
                        icon={<CalendarBlank size={15} />}
                        title="Active window"
                        status={windowSet ? "complete" : "default"}
                        summary={windowSummary}
                        summaryCollapsedOnly
                    >
                        <WindowField
                            startTime={startTime}
                            endTime={endTime}
                            onChangeStart={setStartTime}
                            onChangeEnd={setEndTime}
                        />
                    </ConfigAccordionSection>

                    <ConfigAccordionSection
                        size="compact"
                        icon={<GitBranch size={15} />}
                        title={<RequiredTitle>Which version runs?</RequiredTitle>}
                        status={versionChosen ? "complete" : "warning"}
                        summary={versionSummary}
                        summaryCollapsedOnly
                    >
                        <RunVersionField
                            bindMode={bindMode}
                            onBindModeChange={setBindMode}
                            revisionAdapter={revisionAdapter}
                            revisionPlaceholder={
                                workflowLabel ??
                                resolvedRevisionName ??
                                (playgroundEntityId
                                    ? "Select a variant revision"
                                    : "Select workflow revision")
                            }
                            onRevisionSelect={(selection) => {
                                setWorkflowRevId(selection.id)
                                setWorkflowSelection(selection)
                                const m = selection.metadata
                                const app = playgroundAppName ?? m.workflowName
                                const segs: string[] = []
                                if (app) segs.push(app)
                                if (m.variantName && m.variantName !== app) segs.push(m.variantName)
                                let label = segs.join(" / ")
                                if (m.revision != null)
                                    label = label ? `${label} · v${m.revision}` : `v${m.revision}`
                                setWorkflowLabel(label || selection.label)
                            }}
                            envOptions={envOptions}
                            envLoading={
                                playgroundEntityId ? appDeployments.isLoading : envQuery.isLoading
                            }
                            environmentSlug={environmentSlug}
                            onEnvironmentChange={setEnvironmentSlug}
                            envNotFound={
                                playgroundEntityId
                                    ? "This agent isn't deployed to any environment yet."
                                    : undefined
                            }
                        />
                    </ConfigAccordionSection>

                    <ConfigAccordionSection
                        size="compact"
                        noDivider
                        icon={<ChatText size={15} />}
                        title="What should the agent do?"
                        status={messageStatus}
                        summary={composedMessage.trim() || undefined}
                        summaryCollapsedOnly
                    >
                        <MessageComposer
                            inputsText={inputsText}
                            onChange={setInputsText}
                            isChat={isChatInput}
                            primaryKey={primaryInputKey}
                            disabled={isMutating}
                        />
                    </ConfigAccordionSection>
                </Form>
            </div>

            <TriggerDrawerFooter
                enabled={enabled}
                onEnabledChange={setEnabled}
                onCancel={onClose}
                run={
                    playgroundEntityId ? (
                        <RunInPlaygroundButton
                            playgroundEntityId={playgroundEntityId}
                            name={name}
                            cron={cron}
                            inputsText={inputsText}
                            message={composedMessage}
                            disabled={!isEdit}
                            onClose={onClose}
                        />
                    ) : undefined
                }
                isMutating={isMutating}
                canSave={isDirty}
                submitLabel={isEdit ? "Save" : "Create"}
                onSubmit={handleSubmit}
            />
        </div>
    )
}

// ---------------------------------------------------------------------------
// RunInPlaygroundButton — the persistent footer CTA (playground only). A cron
// has no external event to wait for: its payload is the static inputs. So this
// simulates a scheduled tick, channelling the resolved inputs into the agent's
// chat session (no save, no waiting). A popover previews what the agent gets.
// ---------------------------------------------------------------------------

function RunInPlaygroundButton({
    playgroundEntityId,
    name,
    cron,
    inputsText,
    message: composedMessage,
    disabled,
    onClose,
}: {
    playgroundEntityId: string
    name: string
    cron: string
    inputsText: string
    message: string
    disabled?: boolean
    onClose: () => void
}) {
    const setPendingRun = useSetAtom(simulatedAgentRunAtomFamily(playgroundEntityId))

    const parsed = useMemo<{ok: boolean; value: Record<string, unknown>}>(() => {
        try {
            return {ok: true, value: inputsText.trim() ? JSON.parse(inputsText) : {}}
        } catch {
            return {ok: false, value: {}}
        }
    }, [inputsText])

    const preview = useMemo(() => {
        // Prefer the composed message (sent as the agent's user message); otherwise
        // fall back to a JSON dump of the raw inputs.
        if (composedMessage.trim()) return composedMessage
        const label = name || "Scheduled run"
        return `[Scheduled run · ${label} (${cron})]\n\`\`\`json\n${JSON.stringify(parsed.value, null, 2)}\n\`\`\``
    }, [composedMessage, name, cron, parsed])

    const handleRun = useCallback(() => {
        if (!parsed.ok) {
            message.error("Inputs is not valid JSON")
            return
        }
        setPendingRun({text: preview, nonce: Date.now()})
        onClose()
    }, [parsed.ok, preview, setPendingRun, onClose])

    if (disabled) {
        // A draft can't be tested until it exists as a saved schedule.
        return (
            <Tooltip title="Create the schedule first to run it">
                <span>
                    <Button icon={<Play size={14} />} disabled>
                        Run in playground
                    </Button>
                </span>
            </Tooltip>
        )
    }

    return (
        <Popover
            placement="topRight"
            title="Agent will receive"
            content={
                <pre className="m-0 max-h-[240px] max-w-[320px] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-snug">
                    {parsed.ok ? preview : "Inputs is not valid JSON."}
                </pre>
            }
        >
            <Button icon={<Play size={14} />} onClick={handleRun}>
                Run in playground
            </Button>
        </Popover>
    )
}

// ---------------------------------------------------------------------------
// WindowField — optional UTC start/end bounds. [start, end): a tick fires only
// at or after start and strictly before end; either side empty = unbounded.
// Past end_time auto-stops the schedule on the next backend refresh.
// ---------------------------------------------------------------------------

function WindowField({
    startTime,
    endTime,
    onChangeStart,
    onChangeEnd,
}: {
    startTime: string | null
    endTime: string | null
    onChangeStart: (next: string | null) => void
    onChangeEnd: (next: string | null) => void
}) {
    return (
        <div className="flex flex-col gap-2">
            <div className="flex gap-3">
                <div className="flex w-[116px] shrink-0 flex-col gap-2">
                    <span className="flex h-8 items-center px-2.5 text-xs text-[var(--ag-colorTextSecondary)]">
                        Start
                    </span>
                    <span className="flex h-8 items-center px-2.5 text-xs text-[var(--ag-colorTextSecondary)]">
                        End
                    </span>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2 border-0 border-l border-solid border-[var(--ag-colorBorderSecondary)] pl-3">
                    <DatePicker
                        showTime={{format: "HH:mm"}}
                        format="YYYY-MM-DD HH:mm"
                        placeholder="Unbounded"
                        className="w-full max-w-prose"
                        value={utcIsoToLocalFace(startTime)}
                        onChange={(d) => onChangeStart(localFaceToUtcIso(d))}
                    />
                    <DatePicker
                        showTime={{format: "HH:mm"}}
                        format="YYYY-MM-DD HH:mm"
                        placeholder="Unbounded"
                        className="w-full max-w-prose"
                        value={utcIsoToLocalFace(endTime)}
                        onChange={(d) => onChangeEnd(localFaceToUtcIso(d))}
                    />
                </div>
            </div>
            <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                Schedule fires only within [start, end). Leave either empty for no bound; past end
                auto-stops it.
            </Typography.Text>
        </div>
    )
}

// ---------------------------------------------------------------------------
// MessageComposer — friendly "what should the agent do?" message that maps to the
// agent's primary input (`messages` for chat agents, else a schema string input).
// "Advanced — raw JSON" swaps to a JSON editor over the full `inputs_fields`; only
// one editor is mounted at a time so the message and JSON never desync.
// ---------------------------------------------------------------------------

function MessageComposer({
    inputsText,
    onChange,
    isChat,
    primaryKey,
    disabled,
}: {
    inputsText: string
    onChange: (next: string) => void
    isChat: boolean
    primaryKey: string
    disabled?: boolean
}) {
    const [rawMode, setRawMode] = useState(false)

    const rawValid = useMemo(() => {
        const t = inputsText.trim()
        if (!t) return true
        try {
            JSON.parse(t)
            return true
        } catch {
            return false
        }
    }, [inputsText])

    if (rawMode) {
        return (
            <div className="flex flex-col gap-1.5">
                <Typography.Link
                    className="!text-[11px] self-start"
                    onClick={() => setRawMode(false)}
                >
                    ← Back to message
                </Typography.Link>
                <div className="overflow-hidden rounded-lg border border-solid border-[var(--ag-colorBorder)]">
                    <Editor
                        initialValue={inputsText || "{}"}
                        onChange={({textContent}) => onChange(textContent)}
                        codeOnly
                        showToolbar={false}
                        language="json"
                        dimensions={{width: "100%", height: 120}}
                        disabled={disabled}
                    />
                </div>
                <Typography.Text
                    type={rawValid ? "secondary" : "danger"}
                    className="!text-[11px] leading-snug"
                >
                    {rawValid
                        ? "Raw inputs sent to the workflow each tick (JSON)."
                        : "Invalid JSON."}
                </Typography.Text>
            </div>
        )
    }

    const message = getScheduleMessage(inputsText, isChat, primaryKey)
    return (
        <div className="flex flex-col gap-1.5">
            <Input.TextArea
                placeholder="Summarize yesterday's support tickets and post the digest to #ops."
                value={message}
                onChange={(e) =>
                    onChange(setScheduleMessage(inputsText, e.target.value, isChat, primaryKey))
                }
                autoSize={{minRows: 2, maxRows: 6}}
                disabled={disabled}
            />
            <div className="flex items-center justify-between gap-2">
                <Typography.Text type="secondary" className="!text-[11px] leading-snug">
                    Sent to the agent{" "}
                    {isChat ? "as the user message" : `as the "${primaryKey}" input`} on each run.
                </Typography.Text>
                <Typography.Link
                    className="!shrink-0 !text-[11px]"
                    onClick={() => setRawMode(true)}
                >
                    Advanced — raw JSON
                </Typography.Link>
            </div>
        </div>
    )
}
