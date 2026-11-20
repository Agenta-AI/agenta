import {useCallback, useState} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import chatMobileScreenCatalog from "@agenta/i18n/catalogs/chat.mobileScreen"
import {agentDisplayNameAtomFamily} from "@agenta/navigation"
import {agentAutoCommitStatusAtomFamily} from "@agenta/playground/state"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {KeyboardShortcutsSheet, useShortcutsSheetHotkey} from "@agenta/ui/shortcuts"
import {cn} from "@agenta/ui/styles"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {FolderSimple, Hammer, LockSimpleIcon, SlidersHorizontal} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {sharingCopy} from "@/lib/sharingCopy"

import {heldCommitAtomFamily} from "../chat/selectedRevision"
import {SessionSharingControl} from "../chat/SessionSharingControl"
import {useSessionHeader} from "../chat/useSessionHeader"
import {NavDrawer} from "../nav/NavDrawer"

import {AgentMenu} from "./AgentMenu"
import {useAgentPanel} from "./agentPanelContext"
import type {PanelContent} from "./agentPanelState"
import {SessionMenu} from "./SessionMenu"
import {useAgentSessionOrder} from "./useAgentSessionOrder"

/** The header's icon buttons: 32 px with a 16 px glyph, 44 px with a 20 px glyph on a phone. */
const HEADER_ICON_CLASS =
    "size-8 shrink-0 rounded-md text-colorTextSecondary max-md:size-11 max-md:rounded-lg"

/** The session tab strip's shortcuts; this screen has no strip, so the sheet leaves them out. */
const TAB_STRIP_SHORTCUTS = ["session.jump", "session.step", "session.close", "session.rename"]

interface SessionHeaderProps {
    agentId: string | null
    /** The revision under edit; absent for a session with no turns yet. */
    entityId: string | null
    sessionId: string
    onUpdate: (revisionId: string) => void
    autoUpdate: boolean
    agentHidden: boolean
    /** False when the reader may not send here: no Export agent (it sends a request). */
    canSend: boolean
    workspaceId: string
    projectId: string
}

/**
 * The session header: the agent and its menu, the save status, the session menu, Share and the
 * three panel icons. It replaces the old top bar and the session tab row.
 */
export const SessionHeader = ({
    agentId,
    entityId,
    sessionId,
    onUpdate,
    autoUpdate,
    agentHidden,
    canSend,
    workspaceId,
    projectId,
}: SessionHeaderProps) => {
    const t = useT(agentLayoutHeaderCatalog)
    const panel = useAgentPanel()
    const base = `/w/${workspaceId}/p/${projectId}`
    const tScreen = useT(chatMobileScreenCatalog)
    // By the agent id first, as the sidebar heading reads it: the name is known before the
    // revision loads.
    const name =
        useAtomValue(agentDisplayNameAtomFamily(agentId ?? entityId ?? "")) ||
        tScreen("chat.mobileScreen.agent")
    const heldCommit = useAtomValue(heldCommitAtomFamily(sessionId))
    const session = useSessionHeader(projectId, sessionId)
    // The agent's session order: archiving the open session moves to the next one.
    const sessionOrder = useAgentSessionOrder(agentId)
    const showAgentActions = Boolean(agentId) && !agentHidden
    // No header button for the shortcuts sheet; `?` still opens it.
    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    useShortcutsSheetHotkey(useCallback(() => setShortcutsOpen(true), []))

    const icon = (content: PanelContent, label: string, glyph: React.ReactNode) => (
        <SimpleTooltip title={label}>
            <Button
                id={`agent-panel-icon-${content}`}
                variant="ghost"
                size="icon-sm"
                aria-label={label}
                aria-pressed={panel.content === content}
                className={cn(
                    HEADER_ICON_CLASS,
                    panel.content === content && "bg-accent text-colorText",
                )}
                onClick={() => void panel.toggle(content)}
            >
                {glyph}
            </Button>
        </SimpleTooltip>
    )

    const shortcuts = (
        <KeyboardShortcutsSheet
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
            omit={TAB_STRIP_SHORTCUTS}
        />
    )
    const revisionStatus =
        entityId && !agentHidden ? (
            <AgentRevisionStatus
                revisionId={entityId}
                historyWorkflowId={agentId}
                onUpdate={onUpdate}
                autoUpdate={autoUpdate}
                checkKey={heldCommit ? `${sessionId}:${heldCommit}` : sessionId}
            />
        ) : null
    // On a phone the Configuration tab row shows the version; row 2 shows it only on a failed save.
    const saveFailed = useAtomValue(agentAutoCommitStatusAtomFamily(entityId ?? "")) === "error"
    const sessionTitle = session.data?.name || t("agentLayout.header.untitledSession")
    const sharing = (
        <SessionSharingControl
            sessionId={sessionId}
            sessionName={session.data?.name ?? ""}
            workspaceId={workspaceId}
            projectId={projectId}
            agentId={agentId}
            buttonClassName={HEADER_ICON_CLASS}
        />
    )

    if (panel.phone) {
        // Two rows on a phone: row 1 is about the agent, row 2 about this session.
        return (
            <header
                data-testid="session-header"
                className="flex min-w-0 shrink-0 flex-col border-0 border-b border-solid border-colorBorderSecondary bg-background"
            >
                <PageTitle title={session.data?.name} />
                {shortcuts}
                <div className="box-border flex h-[52px] min-w-0 items-center gap-0.5 border-0 border-b border-solid border-colorBorderSecondary px-1">
                    <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                    {agentHidden ? (
                        <span className="flex min-w-0 items-center gap-1.5 px-2 text-sm font-medium">
                            <LockSimpleIcon size={14} aria-hidden className="shrink-0" />
                            <span className="truncate">{sharingCopy.privateAgent}</span>
                        </span>
                    ) : agentId ? (
                        <AgentMenu
                            phone
                            agentId={agentId}
                            name={name}
                            sessionId={sessionId}
                            canSend={canSend && Boolean(entityId)}
                            projectId={projectId}
                            base={base}
                        />
                    ) : (
                        <span className="truncate px-2 text-sm font-medium">{name}</span>
                    )}
                    <div className="min-w-0 flex-1" />
                    {showAgentActions && panel.available.configuration
                        ? icon(
                              "configuration",
                              t("agentLayout.header.configuration"),
                              <SlidersHorizontal className="size-5" />,
                          )
                        : null}
                    {showAgentActions && panel.available.builder
                        ? icon(
                              "builder",
                              t("agentLayout.header.builder"),
                              <Hammer className="size-5" />,
                          )
                        : null}
                </div>
                <div className="flex h-12 min-w-0 items-center gap-1 pl-3 pr-1">
                    {agentId ? (
                        <SessionMenu
                            phone
                            agentId={agentId}
                            base={base}
                            sessionId={sessionId}
                            title={sessionTitle}
                            loadFailed={sessionOrder.failed}
                            onRetry={sessionOrder.retry}
                        />
                    ) : null}
                    {/* Mounted even when hidden: it drives session follow. A save can fail after
                        the person leaves Configuration, so the notice and retry show here. Hit
                        areas grow to 44 px; the retry is a span with the button role. */}
                    {revisionStatus ? (
                        <span
                            data-testid="session-header-save-status"
                            className={cn(
                                "shrink-0 items-center [&_:is(button,[role=button])]:relative [&_:is(button,[role=button])]:after:absolute [&_:is(button,[role=button])]:after:-inset-3 [&_:is(button,[role=button])]:after:content-['']",
                                saveFailed ? "flex" : "hidden",
                            )}
                        >
                            {revisionStatus}
                        </span>
                    ) : null}
                    <div className="min-w-0 flex-1" />
                    {icon(
                        "files",
                        t("agentLayout.header.files"),
                        <FolderSimple className="size-5" />,
                    )}
                    {sharing}
                </div>
            </header>
        )
    }

    return (
        <header
            data-testid="session-header"
            className="box-border flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary bg-background px-3"
        >
            <PageTitle title={session.data?.name} />
            {shortcuts}
            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
            {agentHidden ? (
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <LockSimpleIcon size={14} aria-hidden className="shrink-0" />
                    {sharingCopy.privateAgent}
                </span>
            ) : agentId ? (
                <div className="flex min-w-0 items-center gap-2">
                    <AgentMenu
                        agentId={agentId}
                        name={name}
                        sessionId={sessionId}
                        canSend={canSend && Boolean(entityId)}
                        projectId={projectId}
                        base={base}
                    />
                </div>
            ) : (
                <span className="truncate text-[15px] font-semibold">{name}</span>
            )}
            {revisionStatus}
            <div className="flex-1" />
            {agentId ? (
                <SessionMenu
                    agentId={agentId}
                    base={base}
                    sessionId={sessionId}
                    title={sessionTitle}
                    loadFailed={sessionOrder.failed}
                    onRetry={sessionOrder.retry}
                />
            ) : null}
            <span aria-hidden className="h-5 w-px shrink-0 bg-colorBorderSecondary" />
            {sharing}
            {icon("files", t("agentLayout.header.files"), <FolderSimple className="size-4" />)}
            {showAgentActions && panel.available.configuration
                ? icon(
                      "configuration",
                      t("agentLayout.header.configuration"),
                      <SlidersHorizontal className="size-4" />,
                  )
                : null}
            {showAgentActions && panel.available.builder
                ? icon("builder", t("agentLayout.header.builder"), <Hammer className="size-4" />)
                : null}
        </header>
    )
}
