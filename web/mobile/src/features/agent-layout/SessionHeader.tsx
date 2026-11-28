import {useCallback, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import chatMobileScreenCatalog from "@agenta/i18n/catalogs/chat.mobileScreen"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import {agentDisplayNameAtomFamily} from "@agenta/navigation"
import {agentAutoCommitStatusAtomFamily} from "@agenta/playground/state"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {BuilderIcon} from "@agenta/ui/agent-icon"
import {SimpleTooltip} from "@agenta/ui/composed"
import {KeyboardShortcutsSheet, useShortcutsSheetHotkey} from "@agenta/ui/shortcuts"
import {cn} from "@agenta/ui/styles"
import {Button} from "@agenta/ui/ui"
import {DotsThree, FolderSimple, LockSimpleIcon, SlidersHorizontal} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"
import {sharingCopy} from "@/lib/sharingCopy"

import {heldCommitAtomFamily} from "../chat/selectedRevision"
import {SessionSharingControl} from "../chat/SessionSharingControl"
import {useSessionHeader} from "../chat/useSessionHeader"
import {NavDrawer} from "../nav/NavDrawer"

import {AgentMenu, type AgentMenuEntry} from "./AgentMenu"
import {useAgentPanel} from "./agentPanelContext"
import type {PanelContent} from "./agentPanelState"
import {MoreSheet} from "./MoreSheet"
import {SessionMenu} from "./SessionMenu"
import {useAgentSessionOrder} from "./useAgentSessionOrder"

/** The header's icon buttons: the kit's `icon-sm`, the same size as the other header controls. */
const HEADER_ICON_CLASS = "shrink-0 text-muted-foreground"

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
    const tControls = useT(uiControlsCatalog)
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
                    panel.content === content && "bg-accent text-foreground",
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
                // On a phone the failed-save notice keeps its "Not saved" words.
                phone={panel.phone}
            />
        ) : null
    // Mounted for session follow; shown only on a failed save.
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
        // One 44 px bar on a phone: the menu, the session as the one title, Share and More.
        const panelEntry = (content: PanelContent, label: string, glyph: ReactNode) => ({
            key: content,
            label,
            icon: glyph,
            onSelect: () => void panel.toggle(content),
        })
        const moreEntries: AgentMenuEntry[] = [
            ...(showAgentActions && panel.available.configuration
                ? [
                      panelEntry(
                          "configuration",
                          t("agentLayout.header.configuration"),
                          <SlidersHorizontal />,
                      ),
                  ]
                : []),
            panelEntry("files", t("agentLayout.header.files"), <FolderSimple />),
            ...(showAgentActions && panel.available.builder
                ? [panelEntry("builder", t("agentLayout.header.builder"), <BuilderIcon />)]
                : []),
        ]
        const moreLabel = tControls("ui.controls.moreActions")
        const moreButton = (
            <Button
                variant="ghost"
                size="icon-sm"
                aria-label={moreLabel}
                className={HEADER_ICON_CLASS}
            >
                <DotsThree aria-hidden className="size-4" />
            </Button>
        )
        return (
            <header
                data-testid="session-header"
                className="box-border flex h-11 min-w-0 shrink-0 items-center gap-1 border-0 border-b border-solid border-border-muted bg-background px-2"
            >
                <PageTitle title={session.data?.name} />
                {shortcuts}
                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                {agentHidden ? (
                    <LockSimpleIcon
                        size={14}
                        aria-label={sharingCopy.privateAgent}
                        className="shrink-0 text-muted-foreground"
                    />
                ) : null}
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
                ) : (
                    <span className="truncate px-2 text-label">{sessionTitle}</span>
                )}
                {/* Mounted even when hidden: it drives session follow; a failed save shows here. */}
                {revisionStatus ? (
                    <span
                        data-testid="session-header-save-status"
                        className={cn("shrink-0 items-center", saveFailed ? "flex" : "hidden")}
                    >
                        {revisionStatus}
                    </span>
                ) : null}
                <div className="min-w-0 flex-1" />
                {sharing}
                {showAgentActions && agentId ? (
                    <AgentMenu
                        phone
                        agentId={agentId}
                        name={name}
                        sessionId={sessionId}
                        canSend={canSend && Boolean(entityId)}
                        projectId={projectId}
                        base={base}
                        phoneTrigger={moreButton}
                        leadingEntries={moreEntries}
                    />
                ) : (
                    <MoreSheet title={name} trigger={moreButton} items={moreEntries} />
                )}
            </header>
        )
    }

    return (
        <header
            data-testid="session-header"
            className="box-border flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-border-muted bg-background px-3"
        >
            <PageTitle title={session.data?.name} />
            {shortcuts}
            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
            {agentHidden ? (
                <span className="flex min-w-0 items-center gap-1.5 text-label">
                    <LockSimpleIcon size={14} aria-hidden className="shrink-0" />
                    {sharingCopy.privateAgent}
                </span>
            ) : agentId ? (
                // shrink-[4]: the agent name gives way first; no gap, the name button's 8px padding spaces it from the tile.
                <div className="flex min-w-24 shrink-[4] items-center overflow-hidden">
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
                <span className="truncate text-label">{name}</span>
            )}
            {/* Mounted for session follow; shown only on a failed save (history is in the agent menu). */}
            {revisionStatus ? (
                <span className={cn("shrink-0", saveFailed ? "flex" : "hidden")}>
                    {revisionStatus}
                </span>
            ) : null}
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
            {/* A 1px line sets the session picker off from Share and the panel icons. */}
            <span aria-hidden className="h-4 w-px shrink-0 bg-border" />
            <div className="flex shrink-0 items-center gap-1">
                {sharing}
                {showAgentActions && panel.available.configuration
                    ? icon(
                          "configuration",
                          t("agentLayout.header.configuration"),
                          <SlidersHorizontal className="size-4" />,
                      )
                    : null}
                {icon("files", t("agentLayout.header.files"), <FolderSimple className="size-4" />)}
                {showAgentActions && panel.available.builder
                    ? icon(
                          "builder",
                          t("agentLayout.header.builder"),
                          <BuilderIcon className="size-4" />,
                      )
                    : null}
            </div>
        </header>
    )
}
