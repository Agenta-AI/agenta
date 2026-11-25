import {useCallback, useEffect, useRef, useState} from "react"

import {
    AutomationDetailBody,
    AutomationDetailSkeleton,
    AutomationMetaRow,
    AutomationRunHistoryView,
    AutomationTitle,
    AutomationTriggerDrawers,
    useAutomationEditor,
} from "@agenta/automation-ui"
import {useT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {useIsPhone} from "@agenta/ui/phone"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"
import {ScreenScaffold} from "@/components/ScreenScaffold"

import {useBindProjectContext} from "../context/useBindProjectContext"
import {AppShell} from "../nav/AppShell"
import {PageBackBar} from "../page-layout/PageBackBar"
import {PageBackControl} from "../page-layout/PageBackControl"
import {PageLayout} from "../page-layout/PageLayout"
import {useConfirmModal} from "../settings/useConfirmModal"

import {AutomationActionsMenu} from "./AutomationActionsMenu"
import {AutomationRunConversation} from "./AutomationRunConversation"
import {AutomationRunNowButton} from "./AutomationRunNowButton"
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
 *
 * The run history is the SAME screen in another state, not a route of its own: it belongs to this
 * automation, and a URL for it would make "did it work?" somewhere you navigate away to — losing
 * an unsaved draft on the way. The header swaps its back link to match whichever is showing.
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
    const t = useT(automationsScreensCatalog)
    const phone = useIsPhone()
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`

    const {
        automation,
        preview,
        agentName,
        failureReason,
        missing,
        loading,
        dirty,
        saving,
        onRename,
        onToggle,
        setAgent,
        setCron,
        setInputs,
        setEvent,
        setIncludeEvent,
        draft,
        discard,
        save,
    } = useAutomationEditor(automationId)

    // One modal for both questions this screen can ask (leave without saving, delete) would mean
    // one of them waiting on the other; the menu owns its own.
    const {confirm, modal} = useConfirmModal()
    const leave = useUnsavedGuard({
        dirty,
        confirm,
        title: t("automations.screens.leaveTitle"),
        message: t("automations.screens.leaveMessage"),
    })

    // `?view=runs` opens straight on the history — a list row that promises runs should not
    // land the reader on the config to find them.
    const [showRuns, setShowRuns] = useState(() => router.query.view === "runs")
    // On a cold load of a dynamic route the query is empty until the router is ready, so the
    // initialiser above misses it; `applied` makes this a seed rather than a binding, or closing
    // the history would reopen it on the next render.
    const applied = useRef(false)
    useEffect(() => {
        if (applied.current || !router.isReady) return
        applied.current = true
        if (router.query.view === "runs") setShowRuns(true)
    }, [router.isReady, router.query.view])
    // "Last run" opens the history on that run; "See all runs" on the newest.
    const [openRunId, setOpenRunId] = useState<string | undefined>(undefined)
    const openRuns = useCallback((runId?: string) => {
        setOpenRunId(runId)
        setShowRuns(true)
    }, [])
    const closeRuns = useCallback(() => setShowRuns(false), [])

    const renderConversation = useCallback(
        (sessionId: string) => (
            // The transcript is this app's chat surface, so the package takes it as a slot.
            <AutomationRunConversation
                sessionId={sessionId}
                projectId={projectId}
                workspaceId={workspaceId}
                agentId={automation?.agentId ?? null}
            />
        ),
        [automation?.agentId, projectId, workspaceId],
    )

    const listHref = `${base}/automations`
    const automationName = automation?.name || t("automations.screens.detailFallbackTitle")

    const runNow = automation ? (
        <AutomationRunNowButton automation={automation} base={base} dirty={dirty} />
    ) : null

    // The run history is a workbench view (a list and a transcript, full height): its own frame.
    if (showRuns) {
        return (
            <>
                <PageTitle title={t("automations.screens.pageTitle")} context={automation?.name} />
                <AppShell workspaceId={workspaceId} projectId={projectId}>
                    <ScreenScaffold
                        fill
                        header={
                            // Below lg, Back returns to the automation, as the link's name does.
                            <PageBackBar
                                back={{label: automationName, onBack: closeRuns}}
                                column="mx-auto box-border w-full max-w-content-md px-4 sm:pl-7.5 sm:pr-5"
                            />
                        }
                    >
                        <AutomationRunHistoryView
                            automation={automation}
                            header={
                                // The view's own 30px grid, so the arrow lines up with
                                // "Run history" below it.
                                <div className="w-full shrink-0 pt-6 lg:pb-2 lg:pl-[30px] lg:pr-5 lg:pt-8">
                                    <div className="max-lg:hidden">
                                        <PageBackControl
                                            back={{label: automationName, onBack: closeRuns}}
                                        />
                                    </div>
                                </div>
                            }
                            renderConversation={renderConversation}
                            initialRunId={openRunId}
                            phone={phone}
                            runNow={runNow}
                        />
                    </ScreenScaffold>
                </AppShell>
                <AutomationTriggerDrawers />
                {modal}
            </>
        )
    }

    // The automation itself is a general page: back link, name, the switch line, a form.
    return (
        <>
            <PageLayout
                workspaceId={workspaceId}
                projectId={projectId}
                width="md"
                back={{label: t("automations.screens.pageTitle"), href: listHref}}
                documentTitle={t("automations.screens.pageTitle")}
                documentContext={automation?.name}
                title={
                    automation ? (
                        // The name renames in place, so it draws its own heading.
                        <AutomationTitle
                            name={automation.name}
                            description={automation.description}
                            onRename={onRename}
                        />
                    ) : (
                        automationName
                    )
                }
                description={
                    automation ? (
                        <AutomationMetaRow
                            active={automation.isActive}
                            agentName={agentName}
                            updatedAt={automation.updatedAt}
                            onToggle={onToggle}
                        />
                    ) : undefined
                }
                actions={
                    automation ? (
                        <AutomationActionsMenu
                            automation={automation}
                            base={base}
                            onLeave={leave}
                        />
                    ) : undefined
                }
            >
                {automation && preview ? (
                    <AutomationDetailBody
                        headless
                        className="flex flex-col"
                        automation={automation}
                        preview={preview}
                        agentName={agentName}
                        onOpenRunHistory={openRuns}
                        failureReason={failureReason}
                        dirty={dirty}
                        saving={saving}
                        onRename={onRename}
                        onSelectAgent={setAgent}
                        onChangeCron={setCron}
                        onSelectEvent={setEvent}
                        onChangeInputs={setInputs}
                        includeEvent={draft.includeEvent}
                        onChangeIncludeEvent={setIncludeEvent}
                        onToggle={onToggle}
                        runNow={runNow}
                        onDiscard={discard}
                        onSave={() => void save()}
                    />
                ) : loading ? (
                    <AutomationDetailSkeleton />
                ) : missing ? (
                    <p className="m-0 py-16 text-center text-label text-muted-foreground">
                        {t("automations.screens.noLongerExists")}
                    </p>
                ) : null}
            </PageLayout>
            <AutomationTriggerDrawers />
            {modal}
        </>
    )
}
