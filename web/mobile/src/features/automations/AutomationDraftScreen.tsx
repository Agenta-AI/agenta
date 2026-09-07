import {useCallback, useMemo, useState} from "react"

import {
    type TriggerSchedule,
    type TriggerScheduleCreate,
    type TriggerSubscriptionCreate,
} from "@agenta/entities/gatewayTrigger"
import {
    agentWorkflowsListQueryStateAtom,
    workflowVariantsListQueryStateAtomFamily,
    type Workflow,
} from "@agenta/entities/workflow"
import {buildTriggerReferences} from "@agenta/entity-ui/gatewayTrigger"
import {message} from "@agenta/ui/app-message"
import {Check, Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"
import {Button} from "@/components/ui/button"
import {Skeleton} from "@/components/ui/skeleton"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"

import {AutomationAgentField} from "./AutomationAgentField"
import {AutomationBackLink} from "./AutomationBackLink"
import {
    buildAutomationCreate,
    buildAutomationEdit,
    SCHEDULE_EVENT_KEY,
} from "./automationEdit"
import {AutomationInstructionField} from "./AutomationInstructionField"
import type {Automation, AutomationKind} from "./automationModel"
import {AutomationRunsWhenField} from "./AutomationRunsWhenField"
import {AutomationTitle} from "./AutomationTitle"
import {PickerOverlay} from "./pickers/PickerOverlay"
import {AUTOMATION_TEMPLATES} from "./templates"
import {useAutomation} from "./useAutomation"

/** Weekdays at 09:00 UTC — the cadence a blank draft opens on. */
// The comma form, not "1-5": cronToBuilder parses a plain int list, so a range comes back
// unrepresentable and the field would open showing a raw cron instead of "Weekdays at 09:00 UTC".
const DEFAULT_CRON = "0 9 * * 1,2,3,4,5"

/**
 * A stable id for the draft, so `AutomationInstructionField` never re-hydrates its composer
 * mid-edit (it rehydrates on an id change, and a draft's id never changes).
 */
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
    /** Event drafts only; nothing sets these until an event draft has its own picker. */
    connectionId: string | null
    eventKey: string | null
}

/**
 * A new automation, before it exists.
 *
 * The detail screen minus what a draft has not earned: no description line, no meta row or
 * toggle, no failure banner, no run history — there is nothing to report about a thing that has
 * never run. What remains is the same three fields, rendered by the same components, so the
 * screen someone creates on and the screen they land on are visibly one screen.
 *
 * Every edit is local. The detail screen saves per field because each field is already a row;
 * here there is no row to PUT to, so the whole draft goes out once, on Create.
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
        name: template?.title ?? "Untitled automation",
        description: template?.body ?? "",
        kind: "schedule",
        cron: DEFAULT_CRON,
        agentId: null,
        inputsFields: {},
        connectionId: null,
        eventKey: null,
    }))
    const [agentPickerOpen, setAgentPickerOpen] = useState(false)
    const [saving, setSaving] = useState(false)

    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])
    const agentName = useMemo(() => {
        const agent = agents.find((candidate) => candidate.id === draft.agentId)
        return agent?.name || agent?.slug || null
    }, [agents, draft.agentId])

    // "Latest" binds the agent's VARIANT so the newest revision resolves at run time — the same
    // rule `AgentPicker` obeys on an existing row. An agent with more than one variant (or one
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
        const raw: TriggerSchedule = {
            data: {
                event_key: SCHEDULE_EVENT_KEY,
                schedule: draft.cron,
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

    const pickAgent = useCallback((agentId: string) => {
        setAgentPickerOpen(false)
        setDraft((current) => ({...current, agentId}))
    }, [])

    const onCreate = useCallback(async () => {
        if (blockedReason || saving) return
        setSaving(true)
        try {
            const created = await create(buildAutomationCreate(draft, references))
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
    }, [base, blockedReason, create, draft, references, router, saving])

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
                        <AutomationTitle name={draft.name} description="" onRename={onRename} />

                        <div className="mt-[26px] flex flex-col gap-[22px]">
                            <PickerOverlay
                                open={agentPickerOpen}
                                onOpenChange={setAgentPickerOpen}
                                title="Run which agent?"
                                contentClassName="w-[320px]"
                                // The field IS the anchor, wrapped because the overlay clones a
                                // DOM node and `AutomationAgentField` is a component. The
                                // wrapper carries the open/close handler, so the field only has
                                // to be enabled — a disabled button swallows the click before
                                // it ever reaches the trigger.
                                trigger={
                                    <div>
                                        <AutomationAgentField
                                            agentName={agentName}
                                            onOpenAgentPicker={() => undefined}
                                        />
                                    </div>
                                }
                            >
                                <div className="bg-popover max-h-[320px] min-h-0 overflow-y-auto p-1 pb-3 lg:pb-1">
                                    {agentsQuery.isPending ? (
                                        <div className="flex flex-col gap-1 p-1">
                                            <Skeleton className="h-8 w-full" />
                                            <Skeleton className="h-8 w-4/5" />
                                            <Skeleton className="h-8 w-3/5" />
                                        </div>
                                    ) : agents.length === 0 ? (
                                        <p className="text-muted-foreground m-0 px-3 py-6 text-center text-xs">
                                            No agents in this project yet.
                                        </p>
                                    ) : (
                                        agents.map((agent) => {
                                            const id = agent.id
                                            if (!id) return null
                                            const bound = id === draft.agentId
                                            return (
                                                <button
                                                    key={id}
                                                    type="button"
                                                    onClick={() => pickAgent(id)}
                                                    aria-current={bound || undefined}
                                                    className="hover:bg-accent flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-2 text-left"
                                                >
                                                    <Robot
                                                        aria-hidden
                                                        size={16}
                                                        className="text-muted-foreground shrink-0"
                                                    />
                                                    <span className="text-foreground min-w-0 flex-1 truncate text-sm">
                                                        {agent.name?.trim() ||
                                                            agent.slug?.trim() ||
                                                            "Untitled agent"}
                                                    </span>
                                                    {bound ? (
                                                        <Check
                                                            aria-label="Currently picked"
                                                            size={14}
                                                            className="text-primary shrink-0"
                                                        />
                                                    ) : null}
                                                </button>
                                            )
                                        })
                                    )}
                                </div>
                            </PickerOverlay>

                            <AutomationRunsWhenField
                                automation={preview}
                                onChangeCron={onChangeCron}
                            />
                            <AutomationInstructionField
                                automationId={DRAFT_ID}
                                agentId={draft.agentId}
                                inputsFields={draft.inputsFields}
                                onCommit={onChangeInputs}
                            />
                        </div>

                        <div className="mt-[30px] flex items-center justify-end gap-2.5 border-0 border-t border-solid border-border pt-5">
                            <Button
                                type="button"
                                variant="outline"
                                onClick={() => void router.push(`${base}/automations`)}
                            >
                                Cancel
                            </Button>
                            {/* A disabled button takes no pointer events, so the reason has to
                                hang off something that does. */}
                            <span title={blockedReason || undefined}>
                                <Button
                                    type="button"
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
        </>
    )
}
