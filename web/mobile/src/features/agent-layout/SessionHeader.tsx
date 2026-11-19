import {useCallback, useState} from "react"

import {workflowMolecule} from "@agenta/entities/workflow"
import {AgentIdentity} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import chatMobileScreenCatalog from "@agenta/i18n/catalogs/chat.mobileScreen"
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
    const artifactName = useAtomValue(
        workflowMolecule.selectors.artifactName(entityId ?? agentId ?? ""),
    )
    const name = artifactName || tScreen("chat.mobileScreen.agent")
    const heldCommit = useAtomValue(heldCommitAtomFamily(sessionId))
    const session = useSessionHeader(projectId, sessionId)
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
                    "size-8 shrink-0 max-md:size-11",
                    panel.content === content && "bg-colorFillSecondary text-colorText",
                )}
                onClick={() => void panel.toggle(content)}
            >
                {glyph}
            </Button>
        </SimpleTooltip>
    )

    return (
        <header
            data-testid="session-header"
            className="flex h-12 shrink-0 items-center gap-2 border-0 border-b border-solid border-colorBorderSecondary px-3"
        >
            <PageTitle title={session.data?.name} />
            <KeyboardShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
            <NavDrawer workspaceId={workspaceId} projectId={projectId} />
            {agentHidden ? (
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                    <LockSimpleIcon size={14} aria-hidden className="shrink-0" />
                    {sharingCopy.privateAgent}
                </span>
            ) : (
                <div className="flex min-w-0 items-center gap-1">
                    <AgentIdentity workflowId={agentId} name={name} />
                    {agentId ? (
                        <AgentMenu
                            agentId={agentId}
                            name={name}
                            sessionId={sessionId}
                            canSend={canSend && Boolean(entityId)}
                            projectId={projectId}
                        />
                    ) : null}
                </div>
            )}
            {entityId && !agentHidden ? (
                <AgentRevisionStatus
                    revisionId={entityId}
                    historyWorkflowId={agentId}
                    onUpdate={onUpdate}
                    autoUpdate={autoUpdate}
                    checkKey={heldCommit ? `${sessionId}:${heldCommit}` : sessionId}
                />
            ) : null}
            <div className="flex-1" />
            {agentId ? (
                <SessionMenu
                    agentId={agentId}
                    base={base}
                    sessionId={sessionId}
                    title={session.data?.name || t("agentLayout.header.untitledSession")}
                />
            ) : null}
            <span aria-hidden className="h-5 w-px shrink-0 bg-colorBorderSecondary" />
            <SessionSharingControl
                sessionId={sessionId}
                sessionName={session.data?.name ?? ""}
                workspaceId={workspaceId}
                projectId={projectId}
                agentId={agentId}
            />
            {icon("files", t("agentLayout.header.files"), <FolderSimple size={16} />)}
            {showAgentActions && panel.available.configuration
                ? icon(
                      "configuration",
                      t("agentLayout.header.configuration"),
                      <SlidersHorizontal size={16} />,
                  )
                : null}
            {showAgentActions && panel.available.builder
                ? icon("builder", t("agentLayout.header.builder"), <Hammer size={16} />)
                : null}
        </header>
    )
}
