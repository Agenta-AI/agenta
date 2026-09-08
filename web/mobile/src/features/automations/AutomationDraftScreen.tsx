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
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {Button} from "@/components/ui/button"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AutomationAgentField} from "./AutomationAgentField"
import {AutomationBackLink} from "./AutomationBackLink"
import {buildAutomationCreate, SCHEDULE_EVENT_KEY} from "./automationEdit"
import {AutomationInstructionField} from "./AutomationInstructionField"
import {generatedAutomationName, type Automation, type AutomationKind} from "./automationModel"
import {AutomationRunsWhenField} from "./AutomationRunsWhenField"
import {AutomationTitle} from "./AutomationTitle"
import {AutomationTriggerDrawers} from "./AutomationTriggerDrawers"
import {type EventSelection} from "./pickers/EventPickerPanel"
import {AUTOMATION_TEMPLATES} from "./templates"
import {useAutomation} from "./useAutomation"

/** Weekdays at 09:00 UTC — the cadence a blank draft opens on. */
// The comma form, not "1-5": cronToBuilder parses a plain int list, so a range comes back
// unrepresentable and the field would open showing a raw cron instead of "Weekdays at 09:00 UTC".
const DEFAULT_CRON = "0 9 * * 1,2,3,4,5"

/** A stand-in id for the draft, so the field components have an `Automation` to read. */
const DRAFT_ID = "new"

/** Everything a draft carries before it becomes a row. */
interface AutomationDraft {
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
}

/**
 * A new automation, before it exists.
 *
 * The detail screen minus what a draft has not earned: no description line, no meta row or
 * toggle, no failure banner, no run history — there is nothing to report about a thing that has
 * never run. What remains is the same three fields, rendered by the same components, so the
 * screen someone creates on and the screen they land on are visibly one screen.
 *
 * Every edit is local, and so is the detail screen's: the difference is only where the draft ends
 * up — there it is a PUT to an existing row, here the whole draft goes out once, on Create.
 */
export const AutomationDraftScreen = ({
    workspaceId,
    projectId,
    templateId,
}: {
    workspaceId: string
    projectId: string
    /** `?template=` from the empty state's cards — seeds the name and description only. */
    templateId?: string
}) => {
    useBindProjectContext(projectId)
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`

    const template = useMemo(
        () => AUTOMATION_TEMPLATES.find((candidate) => candidate.id === templateId) ?? null,
        [templateId],
    )

    // Seeded once: a template is a starting point, so a later query change must not overwrite
    // what has been typed since. The route remounts per `?template=` anyway (see `new.tsx`).
    const [draft, setDraft] = useState<AutomationDraft>(() => ({
        // Blank without a template, so the page opens on an empty, focused name field
        // rather than on a placeholder the user has to clear first.
        name: template?.title ?? "",
        description: template?.body ?? "",
        kind: "schedule",
        cron: DEFAULT_CRON,
        agentId: null,
        inputsFields: {},
        connectionId: null,
        eventKey: null,
    }))
    const [saving, setSaving] = useState(false)

    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])
    const agentName = useMemo(() => {
        const agent = agents.find((candidate) => candidate.id === draft.agentId)
        return agent?.name || agent?.slug || null
    }, [agents, draft.agentId])

    // "Latest" binds the agent's VARIANT so the newest revision resolves at run time — the same
    // rule the detail screen's own save obeys. An agent with more than one variant (or one
    // whose variants have not landed yet) binds the artifact alone, which is what the desktop
    // drawer writes too.
    const variants = useAtomValue(workflowVariantsListQueryStateAtomFamily(draft.agentId ?? ""))
    const references = useMemo(() => {
        if (!draft.agentId) return undefined
        const only = variants.data.length === 1 ? variants.data[0] : null
        return buildTriggerReferences({
            mode: "latest",
            workflowId: draft.agentId,
            variantId: only?.id ?? null,
            revisionId: null,
            family: "application",
        })
    }, [draft.agentId, variants.data])

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
            isActive: true,
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

    const {create} = useAutomation(undefined, draft.kind)

    const onRename = useCallback(async (name: string) => {
        setDraft((current) => ({...current, name: name.trim() || current.name}))
        return true
    }, [])

    const onChangeCron = useCallback((cron: string) => {
        setDraft((current) => ({...current, cron}))
    }, [])

    const onChangeInputs = useCallback((inputsFields: Record<string, unknown>) => {
        setDraft((current) => ({...current, inputsFields}))
    }, [])

    const onSelectAgent = useCallback((agentId: string) => {
        setDraft((current) => ({...current, agentId}))
    }, [])

    // A draft's kind is still free: nothing has been created, so switching is a local change of
    // which half of the "Runs when" control is showing.
    const onChangeKind = useCallback((kind: AutomationKind) => {
        setDraft((current) => ({...current, kind}))
    }, [])

    const onSelectEvent = useCallback(({connectionId, eventKey, triggerConfig}: EventSelection) => {
        setDraft((current) => ({...current, connectionId, eventKey, triggerConfig}))
    }, [])

    const onCreate = useCallback(async () => {
        if (blockedReason || saving) return
        setSaving(true)
        try {
            // The name is optional: an unnamed automation is saved under the name the heading
            // has been previewing, not under a blank.
            const created = await create(
                buildAutomationCreate(
                    {...draft, name: draft.name.trim() || generatedName},
                    references,
                ),
            )
            if (!created?.id) {
                message.error("Couldn't create this automation")
                return
            }
            message.success("Automation created — it's on and will run at its next time")
            await router.push(`${base}/automations/${created.id}`)
        } catch {
            message.error("Couldn't create this automation")
        } finally {
            setSaving(false)
        }
    }, [base, blockedReason, create, draft, generatedName, references, router, saving])

    return (
        <>
            <PageTitle title="Automations" context="New automation" />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="mx-auto w-full max-w-[760px] shrink-0 px-8 pb-3.5 pt-[30px]">
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <AutomationBackLink href={`${base}/automations`} />
                            </div>
                        </div>
                    }
                >
                    <div className="mx-auto flex w-full max-w-[760px] flex-col px-8 pb-[70px]">
                        <AutomationTitle
                            name={draft.name}
                            description=""
                            onRename={onRename}
                            autoEdit={!template}
                            placeholder="Automation name"
                            fallback={generatedName}
                        />

                        <div className="mt-[26px] flex flex-col gap-[22px]">
                            <AutomationAgentField
                                agentId={draft.agentId}
                                agentName={agentName}
                                onSelectAgent={onSelectAgent}
                            />
                            <AutomationRunsWhenField
                                automation={preview}
                                onChangeCron={onChangeCron}
                                onChangeKind={onChangeKind}
                                onSelectEvent={onSelectEvent}
                            />
                            <AutomationInstructionField
                                agentId={draft.agentId}
                                inputsFields={draft.inputsFields}
                                onCommit={onChangeInputs}
                            />
                        </div>

                        <div className="mt-[30px] flex items-center justify-end gap-2.5 border-0 border-t border-solid border-border pt-5">
                            <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="text-xs font-normal"
                                onClick={() => void router.push(`${base}/automations`)}
                            >
                                Cancel
                            </Button>
                            {/* A disabled button takes no pointer events, so the reason has to
                                hang off something that does. */}
                            <span title={blockedReason || undefined}>
                                <Button
                                    type="button"
                                    size="sm"
                                    className="text-xs font-normal"
                                    disabled={!!blockedReason || saving}
                                    title={blockedReason || undefined}
                                    onClick={() => void onCreate()}
                                >
                                    Create automation
                                </Button>
                            </span>
                        </div>
                    </div>
                </ScreenScaffold>
            </AppShell>
            <AutomationTriggerDrawers />
        </>
    )
}
