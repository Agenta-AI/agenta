import {useCallback, useMemo, useState} from "react"

import {type TriggerSchedule, type TriggerSubscription} from "@agenta/entities/gatewayTrigger"
import {
    agentWorkflowsListQueryStateAtom,
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
import {type AutomationTemplate} from "./templates"
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
    /** Seeded by a template and sent on create; the draft never renders a description line. */
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
    template,
    defaultKind = "schedule",
    defaultAgentId = null,
    defaultAgentName = null,
    defaultReferences,
}: {
    /** Seeds the name and the instruction. */
    template?: AutomationTemplate | null
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
    // Seeded once: a template is a starting point, so a later change must not overwrite what has
    // been typed since.
    const [draft, setDraft] = useState<AutomationDraft>(() => ({
        // Blank without a template, so a create surface can open on an empty, focused name field
        // rather than on a placeholder the user has to clear first.
        name: template?.title ?? "",
        description: template?.body ?? "",
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

    // "Latest" binds the agent's VARIANT so the newest revision resolves at run time — the same
    // rule an edit's save obeys. An agent with more than one variant (or one whose variants have
    // not landed yet) binds the artifact alone, which is what the desktop drawer writes too.
    const variants = useAtomValue(workflowVariantsListQueryStateAtomFamily(draft.agentId ?? ""))
    const references = useMemo(() => {
        if (defaultReferences) return defaultReferences
        if (!draft.agentId) return undefined
        const only = variants.data.length === 1 ? variants.data[0] : null
        return buildTriggerReferences({
            mode: "latest",
            workflowId: draft.agentId,
            variantId: only?.id ?? null,
            revisionId: null,
            family: "application",
        })
    }, [defaultReferences, draft.agentId, variants.data])

    // One sentence that both disables the button and explains it, so the two can never disagree.
    const blockedReason = useMemo(() => {
        if (!draft.agentId) return "Pick the agent this automation runs"
        if (draft.kind === "schedule") {
            return draft.cron.trim() ? "" : "Choose when this automation runs"
        }
        return draft.connectionId && draft.eventKey
            ? ""
            : "Choose the event this automation runs on"
    }, [draft.agentId, draft.connectionId, draft.cron, draft.eventKey, draft.kind])

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

    /** Resolves to the created row, or null. Messages are owned here; navigation is not. */
    const create = useCallback(async () => {
        if (blockedReason || saving) return null
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
