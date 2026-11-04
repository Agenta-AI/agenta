import {useCallback, useEffect, useState} from "react"

import {phoneViewportAtom} from "@agenta/chat/state"
import {browserLiveStatusQueryAtomFamily, browserPaneOpenAtomFamily} from "@agenta/entities/browser"
import {workflowMolecule} from "@agenta/entities/workflow"
import {AgentIdentity} from "@agenta/entity-ui/agent"
import {BrowserPaneToggle} from "@agenta/entity-ui/browser"
import {FilesPaneToggle, useSessionFilesPane} from "@agenta/entity-ui/drive"
import {AgentPageHeader, AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {sessionRowVm} from "@agenta/sessions/row"
import {isBrowserEnabled} from "@agenta/shared/api"
import {KeyboardShortcutsSheet, useShortcutsSheetHotkey} from "@agenta/ui/shortcuts"
import {Button} from "@agenta/ui/ui"
import {LockSimpleIcon, PlusIcon} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {sharingCopy} from "@/lib/sharingCopy"

import {NavDrawer} from "../nav/NavDrawer"

import {heldCommitAtomFamily} from "./selectedRevision"
import {sessionBarPanelAtom} from "./sessionBarState"
import {SessionMoreMenu} from "./SessionMoreMenu"
import {SessionSharingControl} from "./SessionSharingControl"
import {SessionSwitcher} from "./SessionSwitcher"
import {ShareMenu} from "./ShareMenu"
import {useSessionHeader} from "./useSessionHeader"
import {useStartBlankSession} from "./useStartBlankSession"

/**
 * The session workspace's one bar: which agent, which session, and what you can do with them. It
 * spans both panes, so the identity belongs to the workspace and not to either pane.
 *
 * No Build/Chat switch: the config pane is shown or collapsed, and that is the whole model.
 */
export const SessionTopBar = ({
    entityId,
    sessionId,
    onUpdate,
    agentId,
    agentResolving = false,
    agentHidden = false,
    canSend = true,
    hasSessions,
    workspaceId,
    projectId,
}: {
    /** The revision under edit. Absent = a session with no turns yet (nothing committed to show). */
    entityId: string | null
    /** The session on screen. */
    sessionId: string
    /** Pin this session to a newer version the user asked for. */
    onUpdate: (revisionId: string) => void
    agentId?: string | null
    /** A null `agentId` is not yet the answer. */
    agentResolving?: boolean
    /** A private agent the reader cannot see: a lock and "Private agent", nothing to act on. */
    agentHidden?: boolean
    /** False when the reader may not send here: no template requests (they send a message). */
    canSend?: boolean
    /** False on first run: one draft session, so no switcher and no session controls. */
    hasSessions: boolean
    workspaceId: string
    projectId: string
}) => {
    // Seeded at load, unlike a media query, so the first paint already has the right layout.
    const phone = useAtomValue(phoneViewportAtom)
    // artifactName resolves from a revision id or a workflow id, so either handle names the agent.
    const name = useAtomValue(workflowMolecule.selectors.artifactName(entityId ?? agentId ?? ""))
    const agentName = agentHidden ? sharingCopy.privateAgent : name || "Agent"
    // A commit the session held back (unsaved config edits) is a reason to check for a newer
    // version now, so the status offers it at once.
    const heldCommit = useAtomValue(heldCommitAtomFamily(sessionId))
    const stream = useSessionHeader(projectId, sessionId).data ?? null
    const sessionName = stream
        ? sessionRowVm(stream, {pinned: false, pending: undefined}).title
        : "New session"
    const startBlank = useStartBlankSession(`/w/${workspaceId}/p/${projectId}`)

    const [shortcutsOpen, setShortcutsOpen] = useState(false)
    useShortcutsSheetHotkey(useCallback(() => setShortcutsOpen(true), []))

    // A panel belongs to the session it was opened on.
    const setPanel = useSetAtom(sessionBarPanelAtom)
    useEffect(() => () => setPanel(null), [sessionId, setPanel])

    const {open: filesOpen, toggle: toggleFiles} = useSessionFilesPane(
        agentId ?? sessionId,
        sessionId,
    )
    const browser = useAtomValue(browserLiveStatusQueryAtomFamily(sessionId)).data
    const [browserOpen, setBrowserOpen] = useAtom(browserPaneOpenAtomFamily(sessionId))

    const revision =
        entityId && !agentHidden ? (
            <AgentRevisionStatus
                revisionId={entityId}
                historyWorkflowId={agentId}
                onUpdate={onUpdate}
                checkKey={heldCommit ? `${sessionId}:${heldCommit}` : sessionId}
                hideWhenSettled
            />
        ) : undefined

    const switcher = hasSessions ? (
        <SessionSwitcher
            sessionId={sessionId}
            agentId={agentId}
            agentResolving={agentResolving}
            agentName={agentName}
            agentHidden={agentHidden}
            workspaceId={workspaceId}
            projectId={projectId}
            phone={phone}
        />
    ) : null

    const more = (
        <SessionMoreMenu
            sessionId={sessionId}
            entityId={entityId}
            agentId={agentId}
            agentName={agentName}
            agentHidden={agentHidden}
            hasSessions={hasSessions}
            projectId={projectId}
            phone={phone}
            onOpenShortcuts={() => setShortcutsOpen(true)}
        />
    )

    const share =
        agentId && !agentHidden ? (
            <ShareMenu
                agentId={agentId}
                sessionId={sessionId}
                sessionName={sessionName}
                showSession={hasSessions}
                // No revision = read-only replay: no conversation to send into.
                canRequestTemplate={Boolean(entityId) && canSend}
                workspaceId={workspaceId}
                projectId={projectId}
                phone={phone}
            />
        ) : hasSessions ? (
            <SessionSharingControl
                sessionId={sessionId}
                sessionName={sessionName}
                workspaceId={workspaceId}
                projectId={projectId}
                agentId={agentId}
            />
        ) : null

    const shortcuts = (
        <KeyboardShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    )

    if (phone) {
        return (
            <header className="flex h-12 shrink-0 items-center gap-0.5 border-x-0 border-b border-t-0 border-solid border-[var(--ag-shell-line)] bg-[var(--ag-surface-raised)] px-1.5">
                <NavDrawer workspaceId={workspaceId} projectId={projectId} />
                {switcher ?? (
                    <span className="min-w-0 flex-1 truncate text-center text-[15px] font-semibold">
                        {agentName}
                    </span>
                )}
                {revision}
                {hasSessions && agentId ? (
                    <Button
                        variant="ghost"
                        size="icon"
                        aria-label="New session"
                        onClick={() => startBlank(agentId)}
                    >
                        <PlusIcon />
                    </Button>
                ) : null}
                {more}
                {share}
                {shortcuts}
            </header>
        )
    }

    return (
        <AgentPageHeader
            className="md:min-h-12"
            // Nav is the drawer below `lg`; it hides itself where the rail takes over.
            leading={<NavDrawer workspaceId={workspaceId} projectId={projectId} />}
            identity={
                agentHidden ? (
                    <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <LockSimpleIcon size={14} aria-hidden className="shrink-0" />
                        {agentName}
                    </span>
                ) : (
                    <>
                        <AgentIdentity workflowId={agentId} name={agentName} />
                        {revision}
                    </>
                )
            }
            center={switcher}
            actions={
                <>
                    {hasSessions && isBrowserEnabled() && (browser?.running || browserOpen) ? (
                        <BrowserPaneToggle
                            open={browserOpen}
                            onToggle={() => setBrowserOpen(!browserOpen)}
                            needsYou={Boolean(browser?.waiting) && !browserOpen}
                        />
                    ) : null}
                    {hasSessions ? (
                        <FilesPaneToggle open={filesOpen} onToggle={toggleFiles} />
                    ) : null}
                    {more}
                    {agentId && !agentHidden ? (
                        <span aria-hidden className="bg-border mx-1 h-[18px] w-px shrink-0" />
                    ) : null}
                    {share}
                    {shortcuts}
                </>
            }
        />
    )
}
