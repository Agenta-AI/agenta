import {useCallback, useMemo} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {NavDrawer} from "../nav/NavDrawer"
import {useConfirmSheet} from "../settings/useConfirmSheet"

import {AutomationActionsMenu} from "./AutomationActionsMenu"
import {AutomationBackLink} from "./AutomationBackLink"
import {AutomationDetailBody} from "./AutomationDetailBody"
import {buildAutomationEdit} from "./automationEdit"
import {agentLabel} from "./automationModel"
import {AutomationTestRunButton} from "./AutomationTestRunButton"
import {AutomationTriggerDrawers} from "./AutomationTriggerDrawers"
import {AutomationDetailSkeleton} from "./states/AutomationStates"
import {useAutomation} from "./useAutomation"
import {useAutomationDraft} from "./useAutomationDraft"
import {useAutomationRuns} from "./useAutomationRuns"
import {useAutomations} from "./useAutomations"
import {useUnsavedGuard} from "./useUnsavedGuard"

/**
 * One automation — its identity, what it runs, when it runs, and what it is told.
 *
 * The route carries only an id, so the kind is resolved from the two lists (schedules first,
 * then subscriptions) rather than being threaded through from the row that was tapped: a link
 * pasted into a cold tab has to open the same screen. The list row also seeds the body, so the
 * screen is readable before the single-entity fetch lands.
 *
 * The three config fields are one unsaved draft (`useAutomationDraft`) that leaves on Save; only
 * the name and the on/off switch still write on the spot.
 */
export const AutomationDetailScreen = ({
    workspaceId,
    projectId,
    automationId,
}: {
    workspaceId: string
    projectId: string
    automationId: string
}) => {
    useBindProjectContext(projectId)
    const base = `/w/${workspaceId}/p/${projectId}`

    const {automations, isLoading: listLoading} = useAutomations()
    const listed = useMemo(
        () => automations.find((candidate) => candidate.id === automationId),
        [automations, automationId],
    )
    // The entity fetch waits on the kind — until then the hook is inert and the row stands in.
    const {
        automation: fetched,
        edit,
        setActive,
    } = useAutomation(listed ? automationId : undefined, listed?.kind ?? "schedule")
    const automation = fetched ?? listed ?? null

    const {preview, dirty, saving, setAgent, setCron, setInputs, setEvent, discard, save} =
        useAutomationDraft(automation, edit)

    // One sheet for both questions this screen can ask (leave without saving, delete) would mean
    // one of them waiting on the other; the menu owns its own.
    const {confirm, sheet} = useConfirmSheet()
    const leave = useUnsavedGuard({dirty, confirm})

    // The runs answer two questions this screen asks: how many there have been, and whether the
    // last one failed. Same hook and same cache the run history reads, so the caption on the card
    // is the caption on the screen it opens.
    const {caption: runHistoryCaption, failureReason} = useAutomationRuns(automation)

    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    // The DRAFT's agent, not the saved one: the field has to name what a Save would bind.
    const agentName = useMemo(() => {
        const agents: Workflow[] = agentsQuery.data ?? []
        const agent = agents.find((candidate) => candidate.id === preview?.agentId)
        return agentLabel(
            preview?.agentId ?? null,
            agent?.name || agent?.slug || null,
            !agentsQuery.isPending,
        )
    }, [agentsQuery.data, agentsQuery.isPending, preview?.agentId])

    const onRename = useCallback(
        async (name: string) => {
            if (!automation) return false
            return !!(await edit(buildAutomationEdit(automation, {name})))
        },
        [automation, edit],
    )

    // ActiveToggle owns the messages and the spinner; it only needs the promise to settle.
    const onToggle = useCallback(
        async (next: boolean) => {
            if (!automation) return
            await setActive(automation.id, next)
        },
        [automation, setActive],
    )

    return (
        <>
            <PageTitle title="Automations" context={automation?.name} />
            <AppShell workspaceId={workspaceId} projectId={projectId}>
                <ScreenScaffold
                    header={
                        <div className="mx-auto w-full max-w-[760px] shrink-0 px-8 pb-3.5 pt-[30px]">
                            <div className="flex min-w-0 items-center gap-2">
                                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                                <AutomationBackLink href={`${base}/automations`} />
                                {automation ? (
                                    <div className="ml-auto flex shrink-0 items-center gap-1.5">
                                        <AutomationTestRunButton
                                            automation={automation}
                                            base={base}
                                            dirty={dirty}
                                        />
                                        <AutomationActionsMenu
                                            automation={automation}
                                            base={base}
                                            onLeave={leave}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    }
                >
                    {automation && preview ? (
                        <AutomationDetailBody
                            automation={automation}
                            preview={preview}
                            agentName={agentName}
                            runsHref={`${base}/automations/${automation.id}/runs`}
                            failureReason={failureReason}
                            runHistoryCaption={runHistoryCaption}
                            dirty={dirty}
                            saving={saving}
                            onRename={onRename}
                            onSelectAgent={setAgent}
                            onChangeCron={setCron}
                            onSelectEvent={setEvent}
                            onChangeInputs={setInputs}
                            onToggle={onToggle}
                            onDiscard={discard}
                            onSave={() => void save()}
                        />
                    ) : listLoading ? (
                        <AutomationDetailSkeleton />
                    ) : (
                        <p className="m-0 px-8 py-16 text-center text-[13px] text-muted-foreground">
                            This automation no longer exists.
                        </p>
                    )}
                </ScreenScaffold>
            </AppShell>
            <AutomationTriggerDrawers />
            {sheet}
        </>
    )
}
