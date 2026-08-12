/** The schedule drawer's create/edit form (one per drawer open). */
import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {
    getScheduleMessage,
    parseInputsFields,
    isEntityActive,
    suggestScheduleName,
    triggerApiErrorMessage,
    triggerScheduleDrawerAtom,
    useTriggerSchedule,
    validateCron,
    cronToBuilder,
    type TriggerScheduleCreate,
    type TriggerScheduleData,
    type TriggerScheduleEdit,
} from "@agenta/entities/gatewayTrigger"
import {extractInputPortsFromSchema} from "@agenta/entities/runnable"
import {workflowMolecule} from "@agenta/entities/workflow"
import {dayjs} from "@agenta/shared/utils"
import {message} from "@agenta/ui"
import {HeightCollapse} from "@agenta/ui/components"
import {Input, Spinner} from "@agenta/ui/ui"
import {CaretDown, SlidersHorizontal} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

import {DrawerFooter} from "../../../drawers/shared/DrawerFooter"
import {Labelled} from "../../../drawers/shared/Labelled"
import {ScheduleBuilderField} from "../ScheduleBuilderField"
import {AgentField} from "../shared/AgentField"
import {normalizeJson} from "../shared/normalizeJson"
import {
    bindingKey,
    buildTriggerReferences,
    useTriggerBinding,
    type TriggerBinding,
} from "../shared/useTriggerBinding"
import {VersionField} from "../shared/VersionField"

import {DEFAULT_CRON, SCHEDULE_EVENT_KEY} from "./constants"
import {MessageComposer} from "./MessageComposer"
import {RunInPlaygroundButton} from "./RunInPlaygroundButton"
import {WindowField} from "./WindowField"

// ---------------------------------------------------------------------------
// Schedule form — a flat field stack: Name, [Agent], Schedule, Message, and an Advanced
// disclosure holding Version and the active window. The playground already knows the agent, so
// it omits that field; settings picks one.
// ---------------------------------------------------------------------------

export function ScheduleForm({
    scheduleId,
    onClose,
    onSaved,
}: {
    scheduleId?: string
    onClose: () => void
    // Called with the saved schedule's id on success. When provided the drawer stays open;
    // otherwise the form closes it.
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

    // A deleted schedule stays viewable but read-only — its config is history, not a draft.
    const isDeleted = Boolean(schedule?.deleted_at)

    const [name, setName] = useState("")
    const [cron, setCron] = useState(DEFAULT_CRON)
    const [startTime, setStartTime] = useState<string | null>(null)
    const [endTime, setEndTime] = useState<string | null>(null)
    // Carried through save, not editable here — active/paused is toggled from the triggers list.
    const [enabled, setEnabled] = useState(true)
    const [inputsText, setInputsText] = useState("{}")
    const [advancedOpen, setAdvancedOpen] = useState(false)
    // Settings picks the agent; the playground and edit mode resolve it (see `resolved`).
    const [agentWorkflowId, setAgentWorkflowId] = useState<string | null>(null)
    const [binding, setBinding] = useState<TriggerBinding | null>(null)

    const storedReferences = schedule?.data?.references
    const resolved = useTriggerBinding({
        storedReferences: isEdit ? storedReferences : state?.defaultReferences,
        playgroundEntityId,
        agentWorkflowId,
    })
    const activeBinding = binding ?? resolved

    // The bound agent's display name — the drawer title and the Name placeholder both use it.
    const agentName = useAtomValue(
        workflowMolecule.selectors.artifactName(
            activeBinding.workflowId ?? playgroundEntityId ?? "",
        ),
    )

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
        setInputsText(JSON.stringify(schedule.data?.inputs_fields ?? {}, null, 2))
        // The binding is derived from the stored references, never re-picked on open.
    }, [isEdit, schedule, scheduleFetching, scheduleId])

    const cronValidation = useMemo(() => validateCron(cron), [cron])
    const versionChosen = !!activeBinding.workflowId || !!activeBinding.variantId

    // Save enables only on draft changes vs the starting point (loaded schedule in edit,
    // defaults in new). Normalized JSON so formatting isn't a change.
    const baselineSnapshot = useMemo(() => {
        if (isEdit && schedule) {
            return JSON.stringify({
                name: schedule.name ?? "",
                cron: schedule.data?.schedule ?? DEFAULT_CRON,
                startTime: schedule.data?.start_time ?? null,
                endTime: schedule.data?.end_time ?? null,
                enabled: isEntityActive(schedule),
                binding: bindingKey(resolved),
                inputs: normalizeJson(JSON.stringify(schedule.data?.inputs_fields ?? {})),
            })
        }
        return JSON.stringify({
            name: "",
            cron: DEFAULT_CRON,
            startTime: null,
            endTime: null,
            enabled: true,
            binding: bindingKey(resolved),
            inputs: normalizeJson("{}"),
        })
    }, [isEdit, schedule, resolved])

    const isDirty = useMemo(
        () =>
            baselineSnapshot !==
            JSON.stringify({
                name,
                cron,
                startTime,
                endTime,
                enabled,
                binding: bindingKey(activeBinding),
                inputs: normalizeJson(inputsText),
            }),
        [baselineSnapshot, name, cron, startTime, endTime, enabled, activeBinding, inputsText],
    )

    // What shape do the bound app's inputs take? `executionMode` is the runtime's own split:
    // "chat" when the app takes a `messages` array, else "completion" (flat named inputs). The
    // composer writes to `messages` for chat, or the first string input from the schema.
    // Most specific id the molecule can resolve: the open revision, then the pinned one, then
    // the variant, then the artifact. Without the artifact fallback a settings-created schedule
    // reads as a completion app and writes to the wrong input key.
    const schemaSourceId =
        playgroundEntityId ??
        activeBinding.revisionId ??
        activeBinding.variantId ??
        activeBinding.workflowId ??
        ""
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

    // Shown as the placeholder and saved verbatim when the field is left empty, so a schedule
    // is never nameless — "Mon 09:00 — Bug report".
    const namePlaceholder = useMemo(
        () => suggestScheduleName(cronToBuilder(cron).state, agentName),
        [cron, agentName],
    )

    const handleSubmit = useCallback(async () => {
        if (isDeleted) return
        if (!cronValidation.valid) {
            message.error(cronValidation.error ?? "Invalid cron expression")
            return
        }
        if (!versionChosen) {
            message.error("Pick the agent this schedule runs")
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

        const resolvedName = name.trim() || namePlaceholder

        const data: TriggerScheduleData = {
            event_key: schedule?.data?.event_key ?? SCHEDULE_EVENT_KEY,
            schedule: cron.trim(),
            start_time: startTime,
            end_time: endTime,
            inputs_fields: parsedInputs.value,
            references: buildTriggerReferences(activeBinding, storedReferences),
        }

        try {
            let savedId: string | null = null
            if (isEdit && schedule) {
                // Full PUT — carry the whole entity, override owned fields.
                const body: TriggerScheduleEdit = {
                    id: schedule.id as string,
                    name: resolvedName,
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
                    name: resolvedName,
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
            // an edit keeps the drawer open on the saved schedule.
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
        isDeleted,
        cronValidation,
        cron,
        startTime,
        endTime,
        versionChosen,
        activeBinding,
        storedReferences,
        inputsText,
        isEdit,
        schedule,
        name,
        namePlaceholder,
        enabled,
        edit,
        create,
        onClose,
        onSaved,
    ])

    // Create is gated on completeness; edit on having changed something.
    const canSubmit =
        !isDeleted &&
        (isEdit ? isDirty : cronValidation.valid && versionChosen && !!composedMessage.trim())

    if (isEdit && scheduleLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spinner />
            </div>
        )
    }

    return (
        <div className="flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden">
            {isDeleted ? (
                <p className="m-0 bg-colorWarningBg px-6 py-3 text-xs text-colorWarningText">
                    This schedule was deleted. Its saved configuration is read-only.
                </p>
            ) : null}
            <fieldset disabled={isDeleted} className="contents">
                <div className="flex flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-6 py-5">
                    <Labelled label="Name">
                        <Input
                            placeholder={namePlaceholder}
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </Labelled>

                    {!playgroundEntityId && (
                        <Labelled label="Agent">
                            <AgentField
                                workflowId={activeBinding.workflowId}
                                onChange={(id) => {
                                    setAgentWorkflowId(id)
                                    // A different agent invalidates any pinned revision.
                                    setBinding(null)
                                }}
                                disabled={isMutating}
                            />
                        </Labelled>
                    )}

                    <Labelled label="Schedule">
                        <ScheduleBuilderField value={cron} onChange={setCron} />
                    </Labelled>

                    <Labelled label="Message">
                        <MessageComposer
                            inputsText={inputsText}
                            onChange={setInputsText}
                            isChat={isChatInput}
                            primaryKey={primaryInputKey}
                            disabled={isMutating}
                        />
                    </Labelled>

                    <div className="flex flex-col">
                        <button
                            type="button"
                            onClick={() => setAdvancedOpen((v) => !v)}
                            aria-expanded={advancedOpen}
                            // px-0/font-[inherit]: preflight is off, so a bare button keeps the
                            // UA's 6px inline padding (misaligning it from the fields) and Arial.
                            className="flex items-center justify-between border-0 border-t border-solid border-[var(--ag-colorBorderSecondary)] bg-transparent px-0 py-3 font-[inherit]"
                        >
                            <span className="flex items-center gap-2">
                                <SlidersHorizontal
                                    size={15}
                                    className="text-[var(--ag-colorTextSecondary)]"
                                />
                                <span className="text-xs font-medium text-[var(--ag-colorText)]">
                                    Advanced
                                </span>
                            </span>
                            <CaretDown
                                size={14}
                                className={`text-[var(--ag-colorIcon)] transition-transform ${
                                    advancedOpen ? "" : "-rotate-90"
                                }`}
                            />
                        </button>
                        <HeightCollapse open={advancedOpen}>
                            <div className="flex flex-col gap-5 pb-2 pt-1">
                                <Labelled label="Version">
                                    <VersionField
                                        workflowId={activeBinding.workflowId}
                                        binding={activeBinding}
                                        onChange={setBinding}
                                        disabled={isMutating}
                                    />
                                </Labelled>
                                <Labelled label="Active window">
                                    <WindowField
                                        startTime={startTime}
                                        endTime={endTime}
                                        onChangeStart={setStartTime}
                                        onChangeEnd={setEndTime}
                                    />
                                </Labelled>
                            </div>
                        </HeightCollapse>
                    </div>
                </div>
            </fieldset>

            <DrawerFooter
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
                submitLabel={isEdit ? "Save" : "Create schedule"}
                onSubmit={handleSubmit}
            />
        </div>
    )
}
