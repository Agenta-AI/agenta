import {useCallback, useEffect, useMemo, useState} from "react"

import {
    describeCron,
    isEntityActive,
    localFaceToUtcIso,
    nextCronRuns,
    triggerApiErrorMessage,
    triggerScheduleDrawerAtom,
    useTriggerSchedule,
    utcIsoToLocalFace,
    validateCron,
    type TriggerScheduleCreate,
    type TriggerScheduleData,
    type TriggerScheduleEdit,
} from "@agenta/entities/gatewayTrigger"
import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {dayjs} from "@agenta/shared/utils"
import {Editor} from "@agenta/ui/editor"
import {
    Button,
    DatePicker,
    Divider,
    Drawer,
    Form,
    Input,
    Spin,
    Switch,
    Typography,
    message,
} from "antd"
import {useAtom} from "jotai"

import {
    createWorkflowRevisionAdapter,
    EntityPicker,
    type WorkflowRevisionSelectionResult,
} from "../../selection"

const DEFAULT_CRON = "0 9 * * *"
// A schedule fires a synthetic tick; there is no provider event, but the data
// model still requires an `event_key`. We use a stable schedule-tick key.
const SCHEDULE_EVENT_KEY = "schedule.tick"

// Schedules bind the `application_*` reference family (same as subscriptions),
// so the picker only offers application workflows (is_application=True).
const applicationRevisionAdapter = createWorkflowRevisionAdapter({
    workflowListAtom: appWorkflowsListQueryStateAtom,
})

// ---------------------------------------------------------------------------
// TriggerScheduleDrawer (root) — create or edit a schedule.
//
// Binds a recurring UTC cron tick to a workflow revision. Edits are full-PUT:
// the body is sourced from the freshly-fetched schedule and only owned fields
// are overridden. Mirrors TriggerSubscriptionDrawer; the Composio event picker
// is replaced by a validated cron-expression field with a "next runs" hint.
// ---------------------------------------------------------------------------

export default function TriggerScheduleDrawer() {
    const [state, setState] = useAtom(triggerScheduleDrawerAtom)
    const open = !!state
    const isEdit = !!state?.scheduleId

    const handleClose = useCallback(() => setState(null), [setState])

    return (
        <Drawer
            open={open}
            onClose={handleClose}
            title={isEdit ? "Edit schedule" : "New schedule"}
            width={640}
            destroyOnClose
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
        >
            {state && <ScheduleForm key={state.scheduleId ?? "new"} onClose={handleClose} />}
        </Drawer>
    )
}

// ---------------------------------------------------------------------------
// Schedule form
// ---------------------------------------------------------------------------

function ScheduleForm({onClose}: {onClose: () => void}) {
    const [state] = useAtom(triggerScheduleDrawerAtom)
    const scheduleId = state?.scheduleId
    const isEdit = !!scheduleId

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
    const [inputsError, setInputsError] = useState<string | null>(null)

    // Prefill from the freshly-fetched schedule (edit mode).
    useEffect(() => {
        if (!isEdit || !schedule) return
        setName(schedule.name ?? "")
        setCron(schedule.data?.schedule ?? DEFAULT_CRON)
        setStartTime(schedule.data?.start_time ?? null)
        setEndTime(schedule.data?.end_time ?? null)
        setEnabled(isEntityActive(schedule))
        const wfId =
            schedule.data?.references?.application_revision?.id ??
            schedule.data?.references?.application_variant?.id ??
            schedule.data?.references?.workflow_revision?.id ??
            null
        setWorkflowRevId(wfId)
        setWorkflowLabel(wfId)
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
        const variantId = refs?.application_variant?.id ?? refs?.application_revision?.id ?? null
        if (!variantId) return
        const appId = refs?.application?.id ?? null
        setWorkflowRevId(variantId)
        setWorkflowLabel(appId ?? variantId)
        setWorkflowSelection({
            type: "workflowRevision",
            id: variantId,
            label: appId ?? variantId,
            path: [],
            metadata: {
                workflowId: appId ?? "",
                workflowName: "",
                variantId,
                variantName: "",
                revision: 0,
            },
        })
        // Run once per open; `state` is keyed so the form remounts per drawer open.
    }, [isEdit])

    const cronValidation = useMemo(() => validateCron(cron), [cron])

    const handleSubmit = useCallback(async () => {
        if (!cronValidation.valid) {
            message.error(cronValidation.error ?? "Invalid cron expression")
            return
        }
        if (!workflowRevId) {
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
            setInputsError(null)
        } catch {
            setInputsError("Invalid JSON")
            message.error("inputs mapping is not valid JSON")
            return
        }

        // On a fresh pick, send the application family by the picker's ids (its
        // leaf is the variant id). Without a re-pick (edit), resend the stored
        // already-complete references. The BE completes the family either way.
        const meta = workflowSelection?.metadata
        const references = meta
            ? {
                  ...(meta.workflowId ? {application: {id: meta.workflowId}} : {}),
                  application_variant: {id: workflowRevId},
              }
            : (schedule?.data?.references ?? {application_variant: {id: workflowRevId}})

        const data: TriggerScheduleData = {
            event_key: schedule?.data?.event_key ?? SCHEDULE_EVENT_KEY,
            schedule: cron.trim(),
            start_time: startTime,
            end_time: endTime,
            inputs_fields: inputsFields,
            references,
        }

        try {
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
                message.success("Schedule created")
            }
            onClose()
        } catch (error) {
            message.error(triggerApiErrorMessage(error, "Failed to save schedule"))
        }
    }, [
        cronValidation,
        cron,
        startTime,
        endTime,
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
    ])

    if (isEdit && scheduleLoading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Spin />
            </div>
        )
    }

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <div className="flex-1 overflow-y-auto overscroll-contain px-6 py-4">
                <Form layout="vertical">
                    <Form.Item label="Name">
                        <Input
                            placeholder="Schedule name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                        />
                    </Form.Item>

                    <CronField value={cron} onChange={setCron} />

                    <WindowField
                        startTime={startTime}
                        endTime={endTime}
                        onChangeStart={setStartTime}
                        onChangeEnd={setEndTime}
                    />

                    <Form.Item label="Bound workflow" required>
                        <div className="flex items-center gap-2">
                            <EntityPicker<WorkflowRevisionSelectionResult>
                                variant="popover-cascader"
                                adapter={applicationRevisionAdapter}
                                onSelect={(selection) => {
                                    setWorkflowRevId(selection.id)
                                    setWorkflowSelection(selection)
                                    setWorkflowLabel(selection.label)
                                }}
                                size="small"
                                placeholder={workflowLabel ?? "Select workflow revision"}
                            />
                            {workflowLabel && (
                                <Typography.Text type="secondary" className="text-xs truncate">
                                    {workflowLabel}
                                </Typography.Text>
                            )}
                        </div>
                    </Form.Item>

                    <Divider className="!my-2" />

                    <InputsField
                        value={inputsText}
                        onChange={setInputsText}
                        error={inputsError}
                        disabled={isMutating}
                    />

                    <Form.Item label="Active">
                        <Switch checked={enabled} onChange={setEnabled} />
                    </Form.Item>
                </Form>
            </div>

            <Divider className="!m-0" />

            <div className="flex justify-end gap-2 px-6 py-3 shrink-0">
                <Button onClick={onClose}>Cancel</Button>
                <Button type="primary" loading={isMutating} onClick={handleSubmit}>
                    {isEdit ? "Save" : "Create"}
                </Button>
            </div>
        </div>
    )
}

// ---------------------------------------------------------------------------
// CronField — a 5-field cron input with client-side validation, a
// human-readable description, and a "next runs" UTC preview. The backend
// (croniter) remains the source of truth; this is a fast local check + hint.
// ---------------------------------------------------------------------------

function CronField({value, onChange}: {value: string; onChange: (next: string) => void}) {
    const validation = useMemo(() => validateCron(value), [value])
    const description = useMemo(
        () => (validation.valid ? describeCron(value) : null),
        [validation.valid, value],
    )
    const nextRuns = useMemo(
        () => (validation.valid ? nextCronRuns(value, 3) : []),
        [validation.valid, value],
    )

    return (
        <Form.Item
            label="Schedule (cron)"
            required
            validateStatus={validation.valid ? undefined : "error"}
            help={validation.valid ? description : validation.error}
        >
            <Input
                placeholder="minute hour day month weekday (UTC)"
                value={value}
                onChange={(e) => onChange(e.target.value)}
            />
            <Typography.Text type="secondary" className="!text-[11px] leading-snug block mt-1">
                5-field cron in UTC (e.g. <code>0 9 * * *</code> = every day at 09:00 UTC).
            </Typography.Text>
            {validation.valid && nextRuns.length > 0 && (
                <div className="mt-1 flex flex-col gap-0.5">
                    <Typography.Text type="secondary" className="!text-[11px]">
                        Next runs (UTC):
                    </Typography.Text>
                    {nextRuns.map((run) => (
                        <code key={run.toISOString()} className="text-[11px] text-gray-500">
                            {run.toISOString().replace("T", " ").replace(".000Z", " UTC")}
                        </code>
                    ))}
                </div>
            )}
        </Form.Item>
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
        <Form.Item
            label="Active window (UTC, optional)"
            help="Schedule fires only within [start, end). Leave either empty for no bound; past end auto-stops it."
        >
            <div className="flex items-center gap-2">
                <DatePicker
                    showTime={{format: "HH:mm"}}
                    format="YYYY-MM-DD HH:mm"
                    placeholder="Start (unbounded)"
                    className="w-full"
                    value={utcIsoToLocalFace(startTime)}
                    onChange={(d) => onChangeStart(localFaceToUtcIso(d))}
                />
                <DatePicker
                    showTime={{format: "HH:mm"}}
                    format="YYYY-MM-DD HH:mm"
                    placeholder="End (unbounded)"
                    className="w-full"
                    value={utcIsoToLocalFace(endTime)}
                    onChange={(d) => onChangeEnd(localFaceToUtcIso(d))}
                />
            </div>
        </Form.Item>
    )
}

// ---------------------------------------------------------------------------
// InputsField — JSON editor for the static inputs passed to the workflow on
// each tick. A schedule has no event payload, so (unlike subscriptions) the
// values are literals rather than payload selectors.
// ---------------------------------------------------------------------------

function InputsField({
    value,
    onChange,
    error,
    disabled,
}: {
    value: string
    onChange: (next: string) => void
    error: string | null
    disabled?: boolean
}) {
    return (
        <Form.Item
            label="Inputs"
            validateStatus={error ? "error" : undefined}
            help={error ?? "Static inputs passed to the workflow on each tick (JSON)"}
        >
            <div className="rounded-lg border border-solid border-gray-300 dark:border-gray-700 overflow-hidden">
                <Editor
                    initialValue={value || "{}"}
                    onChange={({textContent}) => onChange(textContent)}
                    codeOnly
                    showToolbar={false}
                    language="json"
                    dimensions={{width: "100%", height: 120}}
                    disabled={disabled}
                />
            </div>
        </Form.Item>
    )
}
