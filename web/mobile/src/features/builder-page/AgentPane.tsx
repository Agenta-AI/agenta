import {useEffect, useMemo, useRef, useState, type MutableRefObject} from "react"

import {
    AgentConfigSkeleton,
    SectionMarksContext,
    type MarkableSectionKey,
    type SectionMarks,
} from "@agenta/entity-ui/drill-in"
import {
    DriveSessionProvider,
    SessionFilesPane,
    sessionFilesPaneOpenAtomFamily,
} from "@agenta/entity-ui/drive"
import {formatNumber, useT} from "@agenta/i18n"
import agentLayoutPanelCatalog from "@agenta/i18n/catalogs/agentLayout.panel"
import builderPageCatalog from "@agenta/i18n/catalogs/builder.page"
import schemaControlsCatalog from "@agenta/i18n/catalogs/entityUi.schemaControls"
import {LoadError} from "@agenta/ui/components/presentational"
import {PANE_FOOTER_CLASS, PaneFooterSlotContext} from "@agenta/ui/view-stack"
import {useSetAtom} from "jotai"

import {AccessTab} from "../agent-layout/AccessTab"
import {AgentConfigHost} from "../agent-layout/AgentConfigHost"
import {
    AGENT_CONFIG_TABPANEL_ID,
    AgentConfigTabs,
    agentConfigTabId,
} from "../agent-layout/AgentConfigTabs"
import {AutomationsTab} from "../agent-layout/AutomationsTab"
import {ChannelsTab} from "../agent-layout/ChannelsTab"
import {PaneBackContext, type PaneBack} from "../agent-layout/paneBack"
import type {PageViewStackGuardApi} from "../agent-pages/PageViewStackGuard"
import {useConfigurationRevision} from "../agent-pages/useConfigurationRevision"
import {ConfigPane} from "../chat/ConfigPane"
import {useTriggerTestRun} from "../chat/useTriggerTestRun"

import {followAction} from "./followBuilder"
import {PaneSessionBar} from "./PaneSessionBar"
import {PaneSessions, usePaneSessionPick} from "./PaneSessions"

/** The pane tabs of an agent tab (B03): the Configuration tabs, then Drives and Sessions. */
export const PANE_TABS = [
    "agent",
    "automations",
    "channels",
    "access",
    "drives",
    "sessions",
] as const
export type PaneTab = (typeof PANE_TABS)[number]

/**
 * One agent tab of the builder page's pane: a row of pane tabs over the same views as the right
 * panel and the agent pages, with the same data. It opens on Agent. Only the open pane tab is
 * mounted.
 */
export const AgentPane = ({
    agentId,
    builderSaveToolCallId = null,
    builderSaveRevisionId = null,
    changedSections,
    onSectionOpened,
    guardRef,
    builderSessionId,
    workspaceId,
    projectId,
}: {
    agentId: string
    /** The tool call of the builder's latest save of this agent in this visit; the pane follows it. */
    builderSaveToolCallId?: string | null
    /** The revision that save made; the pane shows it unless a form still edits the held one. */
    builderSaveRevisionId?: string | null
    /** Agent panel sections the builder changed ("Changed by the builder"). */
    changedSections?: MarkableSectionKey[]
    /** The person opened or used a section marked as changed. */
    onSectionOpened?: (section: MarkableSectionKey) => void
    /** The open pane tab's views, shared with the page so it can ask before a builder tab change. */
    guardRef: MutableRefObject<PageViewStackGuardApi | null>
    /** The builder chat: the session the Drives pane reads its session files from. */
    builderSessionId: string
    workspaceId: string
    projectId: string
}) => {
    const t = useT(builderPageCatalog, agentLayoutPanelCatalog)
    const tControls = useT(schemaControlsCatalog)
    const [tab, setTab] = useState<PaneTab>("agent")
    const {revisionId, pin, failed, retry} = useConfigurationRevision(agentId)
    const sessionPick = usePaneSessionPick(projectId, agentId)
    const sessions = sessionPick.query
    const sessionCount = sessions.data?.total ?? sessions.data?.sessions?.length ?? 0
    // An automation's "Run now" starts a new session of this agent, as from the panel.
    useTriggerTestRun({entityId: revisionId, agentId, base: `/w/${workspaceId}/p/${projectId}`})
    // The Agent pane tab's dot: the builder saved a change the pane did not move to show.
    const [agentDot, setAgentDot] = useState(false)
    // A view open inside a tab (a channel's manage view) puts its back link in the header.
    const [paneBack, setPaneBack] = useState<PaneBack | null>(null)
    const [footerSlot, setFooterSlot] = useState<HTMLDivElement | null>(null)
    // The open pane tab's views: an open form with edits asks before a switch.
    const openTab = async (next: PaneTab) => {
        if (next === tab) return
        if (guardRef.current && !(await guardRef.current.stack.closeAll())) return
        setTab(next)
        if (next === "agent") setAgentDot(false)
    }

    // Follow the builder (the 10 second rule): a save of this agent shows the Agent pane tab,
    // unless the person clicked in the pane in the last 10 seconds or a form has edits; then the
    // Agent pane tab gets a dot.
    const lastPointerDown = useRef<number | null>(null)
    // Null at mount: a pane that mounts after the save (the save opened its tab, or the tab
    // opened while the builder saved) still shows it. The page only passes a save of this agent.
    const followed = useRef<string | null>(null)
    useEffect(() => {
        if (!builderSaveToolCallId || builderSaveToolCallId === followed.current) return
        followed.current = builderSaveToolCallId
        const dirty = guardRef.current?.stack.dirty ?? false
        // The pane shows the version the builder saved, unless a form still edits the held one.
        if (!dirty && builderSaveRevisionId) pin(builderSaveRevisionId)
        const action = followAction<PaneTab>({
            paneTab: tab,
            target: "agent",
            now: Date.now(),
            lastPointerDown: lastPointerDown.current,
            dirty,
        })
        if (action === "show") {
            // The tab's open (clean) views close first, as on a tab switch, so Agent shows.
            void (async () => {
                if (guardRef.current && !(await guardRef.current.stack.closeAll())) return
                setTab("agent")
                setAgentDot(false)
            })()
        } else if (action === "dot") setAgentDot(true)
        // Only a new save is followed; the pane tab on screen is read at that moment.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [builderSaveToolCallId])

    const markLabel = t("builder.page.changedByBuilder")
    const sectionMarks = useMemo<SectionMarks | null>(
        () =>
            changedSections?.length && onSectionOpened
                ? {keys: new Set(changedSections), label: markLabel, onOpened: onSectionOpened}
                : null,
        [changedSections, markLabel, onSectionOpened],
    )

    const needsRevision = tab === "agent" || tab === "automations"
    let body
    if (needsRevision && failed)
        body = (
            <div className="p-4">
                <LoadError
                    framed
                    title={tControls("entityUi.schemaControls.configCouldNotLoad")}
                    onRetry={retry}
                />
            </div>
        )
    else if (needsRevision && !revisionId)
        body = (
            // The loaded tab's 16 px line; the cards hang 10 px out of it, as loaded.
            <div className="h-full px-4">
                <AgentConfigSkeleton />
            </div>
        )
    else if (tab === "agent" && revisionId)
        body = (
            <SectionMarksContext.Provider value={sectionMarks}>
                <ConfigPane entityId={revisionId} column />
            </SectionMarksContext.Provider>
        )
    else if (tab === "automations" && revisionId)
        body = (
            <AutomationsTab
                revisionId={revisionId}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        )
    else if (tab === "channels")
        body = (
            <ChannelsTab
                agentId={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        )
    else if (tab === "access")
        body = (
            <AccessTab
                agentId={agentId}
                workspaceId={workspaceId}
                projectId={projectId}
            />
        )
    else if (tab === "drives")
        body = (
            <PaneDrives
                agentId={agentId}
                revisionId={revisionId}
                builderSessionId={builderSessionId}
            />
        )
    else
        body = (
            <PaneSessions
                pick={sessionPick}
                agentId={agentId}
                projectId={projectId}
                workspaceId={workspaceId}
            />
        )

    const label = (key: PaneTab) =>
        key === "drives"
            ? t("builder.page.drives")
            : key === "sessions"
              ? t("builder.page.sessions")
              : t(`agentLayout.panel.${key}`)

    return (
        <div
            className="h-full min-h-0"
            data-testid="builder-agent-pane"
            onPointerDownCapture={() => {
                lastPointerDown.current = Date.now()
            }}
        >
            <AgentConfigHost
                agentId={agentId}
                revisionId={revisionId}
                projectId={projectId}
                readChannels={tab === "agent"}
                rootTitle={label(tab)}
                onWorkflowRevisionCommitted={pin}
                guardRef={guardRef}
            >
                {() => (
                    <div
                        data-pane=""
                        className="ag-panel-raised flex h-full min-h-0 flex-col"
                    >
                        <AgentConfigTabs
                            tabs={PANE_TABS.map((key) => ({
                                key,
                                label: label(key),
                                adornment:
                                    key === "agent" && agentDot ? (
                                        <span
                                            data-testid="pane-tab-dot"
                                            role="img"
                                            aria-label={t("builder.page.changedByBuilder")}
                                            className="size-1.5 shrink-0 bg-primary"
                                        />
                                    ) : key === "sessions" && sessionCount > 0 ? (
                                        <span className="text-meta tabular-nums text-muted-foreground">
                                            {formatNumber(sessionCount)}
                                        </span>
                                    ) : null,
                            }))}
                            value={tab}
                            onSelect={(key) => void openTab(key)}
                            back={paneBack}
                        />
                        {tab === "sessions" ? <PaneSessionBar pick={sessionPick} /> : null}
                        <PaneBackContext.Provider value={setPaneBack}>
                            <PaneFooterSlotContext.Provider value={footerSlot}>
                                <div
                                    id={AGENT_CONFIG_TABPANEL_ID}
                                    role="tabpanel"
                                    aria-labelledby={agentConfigTabId(tab)}
                                    className="min-h-0 flex-1"
                                >
                                    {body}
                                </div>
                            </PaneFooterSlotContext.Provider>
                        </PaneBackContext.Provider>
                        <div ref={setFooterSlot} className={PANE_FOOTER_CLASS} />
                    </div>
                )}
            </AgentConfigHost>
        </div>
    )
}

/**
 * The Drives pane tab: the agent's drives in the Files pane. Its open state is the page's own
 * (`builder-page:<agent>`), so opening it here does not open the Files pane on the agent's pages.
 */
const PaneDrives = ({
    agentId,
    revisionId,
    builderSessionId,
}: {
    agentId: string
    revisionId: string | null
    builderSessionId: string
}) => {
    const scope = `builder-page:${agentId}`
    const setOpen = useSetAtom(sessionFilesPaneOpenAtomFamily(scope))
    useEffect(() => setOpen(true), [setOpen])
    return (
        <DriveSessionProvider
            sessionId={builderSessionId}
            artifactId={agentId}
            revisionId={revisionId}
        >
            <SessionFilesPane scope={scope} sessionId={builderSessionId} closeControl="none" />
        </DriveSessionProvider>
    )
}
