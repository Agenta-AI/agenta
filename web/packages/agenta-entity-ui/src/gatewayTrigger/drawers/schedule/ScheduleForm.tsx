/** The schedule drawer's sectioned create/edit form (one per draft or saved schedule). */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

/* Unused while the Deployed option is hidden — restore with the call site below.
import {
    appEnvironmentsQueryAtomFamily,
    environmentsListQueryAtomFamily,
} from "@agenta/entities/environment"
*/
import {
    describeCron,
    getScheduleMessage,
    parseInputsFields,
    isEntityActive,
    triggerApiErrorMessage,
    triggerScheduleDrawerAtom,
    useTriggerSchedule,
    validateCron,
    type TriggerScheduleCreate,
    type TriggerScheduleData,
    type TriggerScheduleEdit,
} from "@agenta/entities/gatewayTrigger"
import {extractInputPortsFromSchema} from "@agenta/entities/runnable"
import {workflowMolecule, workflowVariantsListDataAtomFamily} from "@agenta/entities/workflow"
import {dayjs} from "@agenta/shared/utils"
import {message} from "@agenta/ui"
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {Input, Spinner} from "@agenta/ui/ui"
import {CalendarBlank, ChatText, Clock, GitBranch, Tag} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

import {DrawerFooter} from "../../../drawers/shared/DrawerFooter"
import {
    createWorkflowRevisionAdapter,
    type WorkflowRevisionSelectionResult,
} from "../../../selection"
import {ScheduleBuilderField} from "../ScheduleBuilderField"
import {normalizeJson} from "../shared/normalizeJson"
import {RequiredTitle} from "../shared/RequiredTitle"
import {
    RunVersionField,
    buildRunVersionReferences,
    composeRevisionLabel,
    extractBoundWorkflowId,
    isRunVersionBound,
} from "../shared/RunVersionField"

import {applicationRevisionAdapter, DEFAULT_CRON, SCHEDULE_EVENT_KEY} from "./constants"
import {MessageComposer} from "./MessageComposer"
import {RunInPlaygroundButton} from "./RunInPlaygroundButton"
import {WindowField} from "./WindowField"

// Seed id for a create-mode default-bind. Variant before revision: the value is written
// back under `application_variant`, so pinning a revision id here would mislabel it.
function extractDefaultBindId(
    refs: Record<string, {id?: string | null} | null | undefined> | null | undefined,
): string | null {
    return refs?.application_variant?.id ?? refs?.application_revision?.id ?? null
}

// ---------------------------------------------------------------------------
// Schedule form
// ---------------------------------------------------------------------------

export function ScheduleForm({
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
        isFetching: scheduleFetching,
        isMutating,
        create,
        edit,
    } = useTriggerSchedule(scheduleId)
    const isDeleted = Boolean(schedule?.deleted_at)

    const [name, setName] = useState("")
    const [cron, setCron] = useState(DEFAULT_CRON)
    const [startTime, setStartTime] = useState<string | null>(null)
    const [endTime, setEndTime] = useState<string | null>(null)
    const [enabled, setEnabled] = useState(true)
    const [workflowRevId, setWorkflowRevId] = useState<string | null>(null)
    const [workflowSelection, setWorkflowSelection] =
        useState<WorkflowRevisionSelectionResult | null>(null)
    const [workflowLabel, setWorkflowLabel] = useState<string | null>(null)
    // The bound workflow (app) id from `refs.application`. A stored `application_variant`
    // pin (the default "runs whatever is deployed variant" bind — see `extractDefaultBindId`)
    // has no revision id, so `workflowRevId` below holds a VARIANT id — unresolvable by the
    // revision-keyed selectors. This id is the fallback key that still resolves an app name.
    const [boundWorkflowId, setBoundWorkflowId] = useState<string | null>(null)
    const [inputsText, setInputsText] = useState("{}")

    // Run agent version: bind to a specific revision (the picker) or to an
    // environment (always runs whatever is deployed there).
    const [bindMode, setBindMode] = useState<"revision" | "environment">("revision")
    const [environmentSlug, setEnvironmentSlug] = useState<string | null>(null)
    const [appSlug, setAppSlug] = useState<string | null>(null)
    /* Unused while the Deployed option is hidden — restore with the call site below.
    const envQuery = useAtomValue(environmentsListQueryAtomFamily(false))
    const environments = envQuery.data?.environments ?? []
    */

    // Resolve the bound revision id to a human label (edit-mode prefill stores only
    // the id) — app name / variant name · vN. These are sync atoms (null for unknown).
    const resolvedArtifact = useAtomValue(
        workflowMolecule.selectors.artifactName(workflowRevId ?? ""),
    )
    const resolvedVariant = useAtomValue(
        workflowMolecule.selectors.variantLabel(workflowRevId ?? ""),
    )
    const resolvedRevData = useAtomValue(workflowMolecule.selectors.data(workflowRevId ?? ""))
    // Fallback path for a variant-only pin (`workflowRevId` is a VARIANT id, not a revision
    // id): the selectors above key off a revision/workflow id and resolve to null, so recover
    // the app name from `boundWorkflowId` and the variant name from its variants list.
    const fallbackArtifact = useAtomValue(
        workflowMolecule.selectors.artifactName(boundWorkflowId ?? ""),
    )
    const boundWorkflowVariants = useAtomValue(
        workflowVariantsListDataAtomFamily(boundWorkflowId ?? ""),
    )
    const fallbackVariant = useMemo(() => {
        const variant = boundWorkflowVariants.find((v) => v.id === workflowRevId)
        return variant?.name ?? variant?.slug ?? null
    }, [boundWorkflowVariants, workflowRevId])
    const resolvedRevisionName = useMemo(() => {
        if (!workflowRevId) return null
        return composeRevisionLabel({
            artifact: resolvedArtifact,
            fallbackArtifact,
            variant: resolvedVariant,
            fallbackVariant,
            version: resolvedRevData?.version,
        })
    }, [
        workflowRevId,
        resolvedArtifact,
        resolvedVariant,
        resolvedRevData?.version,
        fallbackArtifact,
        fallbackVariant,
    ])

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
    /* Unused while the Deployed option is hidden — restore with the call site below.
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
    */

    // Prefill from the freshly-fetched schedule (edit mode). Hydrate once per id: any trigger
    // mutation invalidates this query, and a background refetch must not overwrite the edits
    // in progress.
    const hydratedId = useRef<string | null>(null)
    useEffect(() => {
        if (!isEdit || !schedule) return
        // A refetch serves the stale cache first. Latching on that would freeze the fields on old
        // values (the fresh result hits the guard below and returns) and save them back.
        if (scheduleFetching) return
        const loadedId = (schedule.id as string | undefined) ?? scheduleId ?? null
        if (hydratedId.current === loadedId) return
        hydratedId.current = loadedId
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
            setWorkflowRevId(extractBoundWorkflowId(refs))
            // Label is resolved from the revision id below, not stored as the raw id.
            setBoundWorkflowId(refs?.application?.id ?? null)
        }
        setInputsText(JSON.stringify(schedule.data?.inputs_fields ?? {}, null, 2))
    }, [isEdit, schedule, scheduleFetching, scheduleId])

    // Create-mode default-bind: when opened with `defaultReferences` (e.g. from an
    // agent's config panel), pre-bind the new schedule to that workflow so the user
    // doesn't have to re-pick it. Seed `workflowRevId` from the variant ref and, when
    // present, the workflow (app) id via the selection metadata so `handleSubmit`
    // emits the same `{application, application_variant}` shape a fresh pick would.
    useEffect(() => {
        if (isEdit) return
        const refs = state?.defaultReferences
        setAppSlug(refs?.application?.slug ?? null)
        const variantId = extractDefaultBindId(refs)
        if (!variantId) return
        const appId = refs?.application?.id ?? null
        const label = state?.defaultBoundLabel ?? appId ?? variantId
        setWorkflowRevId(variantId)
        setWorkflowLabel(label)
        setBoundWorkflowId(appId)
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

    // The binding as persisted — the picker's leaf can't represent every shape the BE accepts.
    const storedReferences = schedule?.data?.references
    const versionChosen = isRunVersionBound({
        bindMode,
        workflowRevId,
        environmentSlug,
        storedReferences,
    })

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
                workflowRevId: extractBoundWorkflowId(refs),
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
            workflowRevId: extractDefaultBindId(refs),
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
        if (isDeleted) return
        if (!cronValidation.valid) {
            message.error(cronValidation.error ?? "Invalid cron expression")
            return
        }
        if (bindMode === "environment" && !environmentSlug) {
            message.error("Select an environment")
            return
        }
        // Deployed binding resolves via app slug + environment; without the app the reference
        // is ambiguous (an env can host many apps). Fail loud rather than persist it.
        if (bindMode === "environment" && !appSlug) {
            message.error("This schedule isn't linked to an app — use Pinned (a specific revision)")
            return
        }
        if (bindMode === "revision" && !versionChosen) {
            message.error("Bind a workflow")
            return
        }
        if (startTime && endTime && !dayjs.utc(endTime).isAfter(dayjs.utc(startTime))) {
            message.error("End time must be after start time")
            return
        }

        const parsedInputs = parseInputsFields(inputsText)
        if (parsedInputs.error) {
            message.error(parsedInputs.error)
            return
        }
        const inputsFields = parsedInputs.value

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
            fallbackReferences: storedReferences,
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
                    // Honor the Active toggle at creation (otherwise the BE defaults to active).
                    flags: {is_active: enabled},
                }
                const result = await create(body)
                if (!result) {
                    message.error("Failed to create schedule")
                    return
                }
                savedId = result.id ?? null
                message.success("Schedule created")
            }
            // A newly created schedule dismisses the drawer (it now shows in the triggers list);
            // an edit keeps the master-detail open on the saved schedule (settings closes).
            if (!isEdit) {
                onClose()
            } else if (onSaved && savedId) {
                onSaved(savedId)
            } else {
                onClose()
            }
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
        versionChosen,
        inputsText,
        isEdit,
        schedule,
        name,
        enabled,
        edit,
        create,
        onClose,
        onSaved,
        isDeleted,
    ])

    // Per-section header state: icon tint (complete / warning / default) and a
    // collapsed summary of what's configured.
    const cronValid = cronValidation.valid
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
    // Create is gated on completeness, not on dirtiness — a schedule pre-bound from an
    // agent's config panel already matches its baseline (see the subscription form).
    const canSubmit = !isDeleted && (isEdit ? isDirty : cronValid && versionChosen)

    if (isEdit && scheduleLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spinner />
            </div>
        )
    }

    return (
        <div
            className={`flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden${
                hidden ? " hidden" : ""
            }`}
        >
            {isDeleted ? (
                <p className="m-0 bg-colorWarningBg px-6 py-3 text-xs text-colorWarningText">
                    This schedule was deleted. Its saved configuration is read-only.
                </p>
            ) : null}
            <fieldset disabled={isDeleted} className="contents">
                <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
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
                            hideEnvironment
                            /* Deployed option temporarily hidden — drop `hideEnvironment`
                               and uncomment to restore.
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
                            */
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
                </div>
            </fieldset>

            <DrawerFooter
                enabled={enabled}
                onEnabledChange={isDeleted ? undefined : setEnabled}
                left={
                    isDeleted ? (
                        <span className="text-xs text-colorTextSecondary">Deleted</span>
                    ) : undefined
                }
                onCancel={onClose}
                run={
                    playgroundEntityId && !isDeleted ? (
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
                canSave={canSubmit}
                submitLabel={isEdit ? "Save" : "Create"}
                onSubmit={handleSubmit}
            />
        </div>
    )
}
