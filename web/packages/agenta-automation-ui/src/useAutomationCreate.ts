import {useCallback, useMemo, useState} from "react"

import {type TriggerSchedule, type TriggerSubscription} from "@agenta/entities/gatewayTrigger"
import {
    agentWorkflowsListQueryStateAtom,
    workflowLatestRevisionQueryAtomFamily,
    workflowVariantsListQueryStateAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {buildTriggerReferences} from "@agenta/entity-ui/gatewayTrigger"
import {message} from "@agenta/ui/app-message"
import {useAtomValue} from "jotai"

import {
    buildAutomationCreate,
    SCHEDULE_EVENT_KEY,
    type AutomationReferences,
} from "./automationEdit"
import {generatedAutomationName, type Automation, type AutomationKind} from "./automationModel"
import {type EventSelection} from "./pickers/EventPickerPanel"
import {useAutomation} from "./useAutomation"

/** Weekdays at 09:00 UTC — the cadence a blank draft opens on. */
// The comma form, not "1-5": cronToBuilder parses a plain int list, so a range comes back
// unrepresentable and the builder falls through to the raw expression.
export const DEFAULT_CRON = "0 9 * * 1,2,3,4,5"

/** The id a draft carries: it has none, and the field components key off `automation.id`. */
export const DRAFT_ID = "new"

/** Everything a draft carries before it becomes a row. */
export interface AutomationDraft {
    name: string
    /** Sent on create; the draft never renders a description line of its own. */
    description: string
    kind: AutomationKind
    /** Schedules only — the 5-field UTC cron expression. */
    cron: string
    agentId: string | null
    inputsFields: Record<string, unknown>
    /** Event drafts only — what the "Runs when" event panel handed back. */
    connectionId: string | null
    eventKey: string | null
    triggerConfig?: Record<string, unknown>
    /** Whether it starts running the moment it is created. */
    isActive: boolean
}

/**
 * A new automation, before it exists — the state a create surface needs, with no view attached.
 *
 * Shared by the app's own new-automation screen and by the playground's drawer, so "what a valid
 * new automation is" is answered once. The caller owns what happens after `create` resolves: a
 * screen navigates to the row, a drawer closes over it.
 */
export const useAutomationCreate = ({
    defaultKind = "schedule",
    defaultAgentId = null,
    defaultAgentName = null,
    defaultReferences,
}: {
    /** Which half of the "Runs when" control the draft opens on. */
    defaultKind?: AutomationKind
    /** Pre-bound agent — the playground opens this already knowing whose automation it is. */
    defaultAgentId?: string | null
    /**
     * The pre-bound agent's name. The playground binds by REVISION id, which the agents list
     * cannot resolve, so the host passes the label it already has rather than leaving the
     * generated name to fall back to "Untitled automation".
     */
    defaultAgentName?: string | null
    /**
     * References as the host already has them (the playground's `defaultReferences`). When
     * absent they are derived from the picked agent, which is what the app's own screen does.
     */
    defaultReferences?: AutomationReferences
} = {}) => {
    // Seeded once, so a later change never overwrites what has been typed since.
    const [draft, setDraft] = useState<AutomationDraft>(() => ({
        // Blank, so a create surface opens on an empty, focused name field rather than on a
        // placeholder the user has to clear first.
        name: "",
        description: "",
        kind: defaultKind,
        cron: DEFAULT_CRON,
        agentId: defaultAgentId,
        inputsFields: {},
        connectionId: null,
        eventKey: null,
        isActive: true,
    }))
    const [saving, setSaving] = useState(false)

    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agentName = useMemo(() => {
        const agents: Workflow[] = agentsQuery.data ?? []
        const agent = agents.find((candidate) => candidate.id === draft.agentId)
        return agent?.name || agent?.slug || defaultAgentName || null
    }, [agentsQuery.data, defaultAgentName, draft.agentId])

    // "Latest" binds the agent's VARIANT so the newest revision resolves at run time. The variant
    // comes from the latest revision itself rather than from "the agent happens to have exactly
    // one": an agent with two variants used to bind the artifact alone, which leaves the backend
    // to pick, and an artifact-only binding is how an automation ends up running an old revision.
    const latestRevision = useAtomValue(workflowLatestRevisionQueryAtomFamily(draft.agentId ?? ""))
    const variants = useAtomValue(workflowVariantsListQueryStateAtomFamily(draft.agentId ?? ""))
    const references = useMemo(() => {
        if (defaultReferences) return defaultReferences
        if (!draft.agentId) return undefined
        const only = variants.data.length === 1 ? variants.data[0] : null
        return buildTriggerReferences({
            mode: "latest",
            workflowId: draft.agentId,
            variantId: latestRevision.data?.workflow_variant_id ?? only?.id ?? null,
            revisionId: null,
            family: "application",
        })
    }, [defaultReferences, draft.agentId, latestRevision.data?.workflow_variant_id, variants.data])

    // What is still missing, by field, so the screen can point at each one rather than at the
    // button. Both fields can be missing at once; a reader who sees only the first fixes it and
    // is then told about the second, which is the form equivalent of being sent back twice.
    const missing = useMemo(
        () => ({
            agent: !draft.agentId ? "Pick the agent this automation runs" : "",
            runsWhen:
                draft.kind === "schedule"
                    ? draft.cron.trim()
                        ? ""
                        : "Choose when this automation runs"
                    : draft.connectionId && draft.eventKey
                      ? ""
                      : "Choose the event this automation runs on",
        }),
        [draft.agentId, draft.connectionId, draft.cron, draft.eventKey, draft.kind],
    )
    const blockedReason = missing.agent || missing.runsWhen

    // The errors show only once the reader has tried to create: a form that opens with two
    // red fields is telling them off for not having filled in what they have not reached yet.
    // Once they have tried, the marks stay live — they clear field by field as each is fixed.
    const [attempted, setAttempted] = useState(false)
    const errors = useMemo(
        () => (attempted ? missing : {agent: "", runsWhen: ""}),
        [attempted, missing],
    )

    // The field components read an `Automation`, which is the shape a saved row has. A draft is
    // that shape with nothing behind it — same fields, same labels, no fetch.
    const preview = useMemo<Automation>(() => {
        // Kind-aware, because the event panel prefills its filters off `raw.data.trigger_config`:
        // a schedule-shaped stand-in would drop them every time the overlay reopens.
        const raw: TriggerSchedule | TriggerSubscription =
            draft.kind === "schedule"
                ? {
                      data: {
                          event_key: SCHEDULE_EVENT_KEY,
                          schedule: draft.cron,
                          inputs_fields: draft.inputsFields,
                      },
                  }
                : {
                      connection_id: draft.connectionId ?? "",
                      data: {
                          event_key: draft.eventKey ?? "",
                          trigger_config: draft.triggerConfig,
                          inputs_fields: draft.inputsFields,
                      },
                  }
        return {
            id: DRAFT_ID,
            kind: draft.kind,
            name: draft.name,
            // Never rendered on a draft — the title stands alone until the row exists.
            description: "",
            agentId: draft.agentId,
            isActive: draft.isActive,
            cron: draft.cron,
            eventKey: draft.eventKey,
            connectionId: draft.connectionId,
            updatedAt: null,
            raw,
        }
    }, [draft])

    // What an unnamed automation is called: built from the two things already chosen, so the
    // heading previews the saved name rather than a placeholder that turns into something else.
    const generatedName = useMemo(
        () => generatedAutomationName(preview, agentName),
        [agentName, preview],
    )

    const {create: createEntity} = useAutomation(undefined, draft.kind)

    const setName = useCallback(async (name: string) => {
        setDraft((current) => ({...current, name: name.trim() || current.name}))
        return true
    }, [])
    const setCron = useCallback((cron: string) => {
        setDraft((current) => ({...current, cron}))
    }, [])
    const setInputs = useCallback((inputsFields: Record<string, unknown>) => {
        setDraft((current) => ({...current, inputsFields}))
    }, [])
    const setAgent = useCallback((agentId: string) => {
        setDraft((current) => ({...current, agentId}))
    }, [])
    const setActive = useCallback((isActive: boolean) => {
        setDraft((current) => ({...current, isActive}))
    }, [])
    // A draft's kind is still free: nothing has been created, so switching is a local change of
    // which half of the "Runs when" control is showing.
    const setKind = useCallback((kind: AutomationKind) => {
        setDraft((current) => ({...current, kind}))
    }, [])
    const setEvent = useCallback(({connectionId, eventKey, triggerConfig}: EventSelection) => {
        setDraft((current) => ({...current, connectionId, eventKey, triggerConfig}))
    }, [])

    /**
     * Resolves to the created row, or null. Messages are owned here; navigation is not.
     *
     * A blocked attempt is not refused silently: it turns the field errors on and returns null,
     * so the button is always pressable and pressing it is what points at what is missing.
     */
    const create = useCallback(async () => {
        if (saving) return null
        if (blockedReason) {
            setAttempted(true)
            return null
        }
        setSaving(true)
        try {
            // The name is optional: an unnamed automation is saved under the name the heading has
            // been previewing, not under a blank.
            const created = await createEntity(
                buildAutomationCreate(
                    {...draft, name: draft.name.trim() || generatedName},
                    references,
                ),
            )
            if (!created?.id) {
                message.error("Couldn't create this automation")
                return null
            }
            message.success(
                draft.isActive
                    ? "Automation created — it's on and will run at its next time"
                    : "Automation created — it stays off until you switch it on",
            )
            return created
        } catch {
            message.error("Couldn't create this automation")
            return null
        } finally {
            setSaving(false)
        }
    }, [blockedReason, createEntity, draft, generatedName, references, saving])

    return {
        draft,
        preview,
        agentName,
        generatedName,
        blockedReason,
        errors,
        saving,
        setName,
        setAgent,
        setCron,
        setKind,
        setEvent,
        setInputs,
        setActive,
        create,
    }
}

export type AutomationCreateState = ReturnType<typeof useAutomationCreate>
