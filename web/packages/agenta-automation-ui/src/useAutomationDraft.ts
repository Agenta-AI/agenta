import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {type TriggerSchedule, type TriggerSubscription} from "@agenta/entities/gatewayTrigger"
import {workflowVariantsListQueryStateAtomFamily} from "@agenta/entities/workflow"
import {
    buildTriggerReferences,
    EMPTY_BINDING,
    parseStoredBinding,
} from "@agenta/entity-ui/gatewayTrigger"
import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"

import {buildAutomationEdit, type AutomationEditBody} from "./automationEdit"
import {automationInputsFields, type Automation} from "./automationModel"
import type {EventSelection} from "./pickers/EventPickerPanel"

/** The three config fields, held together because they are saved together. */
export interface AutomationConfigDraft {
    agentId: string | null
    /** Schedules only — the 5-field UTC cron expression. */
    cron: string
    inputsFields: Record<string, unknown>
    /** Event subscriptions only. */
    connectionId: string | null
    eventKey: string | null
    triggerConfig?: Record<string, unknown>
}

interface DraftState {
    /** What the server last told us this automation is. */
    baseline: AutomationConfigDraft
    draft: AutomationConfigDraft
}

type SaveAutomation = (
    body: AutomationEditBody,
) => Promise<TriggerSchedule | TriggerSubscription | null>

const EMPTY_DRAFT: AutomationConfigDraft = {
    agentId: null,
    cron: "",
    inputsFields: {},
    connectionId: null,
    eventKey: null,
}

/**
 * The detail screen's unsaved config — agent, runs-when, instruction — and the one save that
 * persists them.
 *
 * Every field used to write on its own, which made "what is this automation" a question with two
 * answers mid-edit: a cron already saved, an instruction not yet blurred. The three belong to one
 * decision ("run THIS agent on THIS trigger with THIS instruction"), so they are held as one draft
 * and leave together. The name and the on/off switch stay immediate — neither is part of that
 * decision, and both read as a fact about the row rather than an edit to it.
 *
 * `baseline` is what the server last told us, kept beside the draft rather than derived per render:
 * it is what makes a background refetch able to move "saved" without moving what has been typed.
 */
export const useAutomationDraft = (automation: Automation | null, edit: SaveAutomation) => {
    const seed = useMemo(() => seedFrom(automation), [automation])
    const [state, setState] = useState<DraftState>(() => ({baseline: seed, draft: seed}))
    const [saving, setSaving] = useState(false)
    const idRef = useRef<string | null>(automation?.id ?? null)

    // A refetch moves the baseline; it only moves the draft when nothing has been edited (or when
    // this is a different automation entirely, which is a different form, not a stale one).
    useEffect(() => {
        if (!automation) return
        const changedId = idRef.current !== automation.id
        idRef.current = automation.id
        setState((current) => {
            if (!changedId && sameDraft(current.baseline, seed)) return current
            const edited = !changedId && !sameDraft(current.draft, current.baseline)
            return {baseline: seed, draft: edited ? current.draft : seed}
        })
    }, [automation, seed])

    const {draft, baseline} = state
    const dirty = !sameDraft(draft, baseline)

    // Keyed on "" while no agent is picked, which is how this family stays inert. The binding is
    // the agent's VARIANT so the newest revision resolves at run time — the rule lives in
    // `buildTriggerReferences`, and writing references by hand is how bindings go unresolvable.
    const variants = useAtomValue(workflowVariantsListQueryStateAtomFamily(draft.agentId ?? ""))

    const patch = useCallback((next: Partial<AutomationConfigDraft>) => {
        setState((current) => ({...current, draft: {...current.draft, ...next}}))
    }, [])

    const setAgent = useCallback((agentId: string) => patch({agentId}), [patch])
    const setCron = useCallback((cron: string) => patch({cron}), [patch])
    const setInputs = useCallback(
        (inputsFields: Record<string, unknown>) => patch({inputsFields}),
        [patch],
    )
    const setEvent = useCallback(
        ({connectionId, eventKey, triggerConfig}: EventSelection) =>
            patch({connectionId, eventKey, triggerConfig}),
        [patch],
    )

    const discard = useCallback(() => {
        setState((current) => ({...current, draft: current.baseline}))
    }, [])

    const save = useCallback(async () => {
        if (!automation || saving || !dirty) return
        const rebinding = Boolean(draft.agentId && draft.agentId !== baseline.agentId)
        // The variant list is what "latest" binds; saving before it lands would write an
        // artifact-only reference and call it the same binding.
        if (rebinding && variants.isPending) {
            message.error("Still loading that agent — try Save again in a moment")
            return
        }

        setSaving(true)
        try {
            const saved = await edit(
                buildAutomationEdit(automation, {
                    inputsFields: draft.inputsFields,
                    ...(rebinding
                        ? {
                              references: referencesFor(
                                  automation,
                                  draft.agentId,
                                  // Exactly one variant binds it; more than one is ambiguous, and
                                  // the artifact-only reference the builder then writes is what
                                  // the desktop writes too.
                                  variants.data.length === 1
                                      ? (variants.data[0]?.id ?? null)
                                      : null,
                              ),
                          }
                        : {}),
                    ...(automation.kind === "schedule"
                        ? {cron: draft.cron}
                        : {
                              connectionId: draft.connectionId ?? undefined,
                              eventKey: draft.eventKey ?? undefined,
                              triggerConfig: draft.triggerConfig,
                          }),
                }),
            )
            if (!saved) {
                message.error("Couldn't save this automation")
                return
            }
            // The edit is the new baseline immediately: waiting for the refetch would leave the
            // footer standing over changes that are already saved.
            setState((current) => ({baseline: current.draft, draft: current.draft}))
            message.success("Changes saved")
        } catch {
            // The draft is untouched, so the footer stays and nothing typed is lost.
            message.error("Couldn't save this automation")
        } finally {
            setSaving(false)
        }
    }, [automation, baseline.agentId, dirty, draft, edit, saving, variants])

    // The fields read an `Automation` — the saved row with the draft written over it, so they
    // render what WILL be saved rather than what is stored.
    const preview = useMemo<Automation | null>(
        () => (automation ? withDraft(automation, draft) : null),
        [automation, draft],
    )

    return {draft, preview, dirty, saving, setAgent, setCron, setInputs, setEvent, discard, save}
}

function seedFrom(automation: Automation | null): AutomationConfigDraft {
    if (!automation) return EMPTY_DRAFT
    const subscription =
        automation.kind === "event" ? (automation.raw as TriggerSubscription) : null
    return {
        agentId: automation.agentId,
        cron: automation.cron ?? "",
        inputsFields: automationInputsFields(automation),
        connectionId: automation.connectionId,
        eventKey: automation.eventKey,
        triggerConfig: subscription?.data?.trigger_config ?? undefined,
    }
}

function withDraft(automation: Automation, draft: AutomationConfigDraft): Automation {
    if (automation.kind === "schedule") {
        const schedule = automation.raw as TriggerSchedule
        return {
            ...automation,
            agentId: draft.agentId,
            cron: draft.cron,
            raw: {
                ...schedule,
                data: {
                    ...schedule.data,
                    schedule: draft.cron,
                    inputs_fields: draft.inputsFields,
                },
            },
        }
    }

    const subscription = automation.raw as TriggerSubscription
    return {
        ...automation,
        agentId: draft.agentId,
        connectionId: draft.connectionId,
        eventKey: draft.eventKey,
        raw: {
            ...subscription,
            connection_id: draft.connectionId ?? "",
            data: {
                ...subscription.data,
                event_key: draft.eventKey ?? "",
                trigger_config: draft.triggerConfig,
                inputs_fields: draft.inputsFields,
            },
        },
    }
}

/** The rebind, in the family the trigger was stored in — another family resolves differently. */
function referencesFor(automation: Automation, agentId: string | null, variantId: string | null) {
    const stored = automation.raw.data?.references
    const family = (stored ? parseStoredBinding(stored) : EMPTY_BINDING).family
    return buildTriggerReferences(
        {mode: "latest", workflowId: agentId, variantId, revisionId: null, family},
        stored,
    )
}

/** Value equality, because every seed is a fresh object off a fresh query response. */
function sameDraft(a: AutomationConfigDraft, b: AutomationConfigDraft): boolean {
    return (
        a.agentId === b.agentId &&
        a.cron === b.cron &&
        a.connectionId === b.connectionId &&
        a.eventKey === b.eventKey &&
        JSON.stringify(a.inputsFields) === JSON.stringify(b.inputsFields) &&
        JSON.stringify(a.triggerConfig ?? null) === JSON.stringify(b.triggerConfig ?? null)
    )
}
