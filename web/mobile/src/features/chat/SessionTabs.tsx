import {chatPanelMaximizedAtom, configPanelCollapsedAtom} from "@agenta/chat/state"
import {querySessionStreams} from "@agenta/entities/session"
import {useSessionFilesPane} from "@agenta/entity-ui/drive"
import {SessionTabRail, withSessionShortcutKeys} from "@agenta/sessions-ui"
import {shortcutAria} from "@agenta/shared/utils"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Folder, FolderOpen} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"

import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {ConfigRevealButton} from "./ConfigRevealButton"
import {InspectSessionButton} from "./InspectSessionButton"
import {SessionHistoryMenu} from "./SessionHistoryMenu"
import {useSessionTabClose} from "./useSessionTabClose"
import {useStartBlankSession} from "./useStartBlankSession"

/**
 * The conversation pane's header: this agent's sessions as tabs, the open one active — the same
 * strip the desktop playground carries above its transcript.
 *
 * Selecting a tab is a route change here (a session per URL), not a local tab switch, so the rail
 * only needs the host's routing.
 *
 * In Chat mode at md+ the vertical sessions pane sits beside the transcript and owns the switching
 * — the same call the desktop makes (its tag bar drops its pills in full-screen mode), so the rail
 * steps aside there and stays on the narrow frame, where that pane is not on screen.
 */
/** The config-panel reveal and the files-pane opener live in the TAB BAR, as they do on the
 * desktop: `leadingExtra` sits where the config panel disappeared from, `extra` hugs the right
 * edge the pane expands from. Putting them in the page header instead left the files chevron
 * floating in the window's top-right corner, detached from the row it belongs to. */
export const SessionTabs = ({
    sessionId,
    projectId,
    workspaceId,
    agentId,
}: {
    sessionId: string
    projectId: string
    workspaceId: string
    /** Scope the rail to this agent's sessions. Absent while the session's agent resolves. */
    agentId?: string | null
}) => {
    const router = useRouter()
    const base = `/w/${workspaceId}/p/${projectId}`
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)
    // The SAME verbs the sessions pane and the sessions list bind — rename, pin, archive, delete
    // with their confirms — so a session's menu is the same whether it is a tab or a row.
    const menu = useSessionRowMenu(base)
    const startBlank = useStartBlankSession(base)
    const closeTabs = useSessionTabClose({agentId, sessionId, base})
    const configCollapsed = useAtomValue(configPanelCollapsedAtom)
    const {open: filesOpen, toggle: toggleFiles} = useSessionFilesPane(
        agentId ?? sessionId,
        sessionId,
    )
    // Key leads with `session-stream`: a rename patches by key PREFIX, so a nested key never
    // matches and the title lags. The singular GET redirects onto the web app, so POST it.
    const query = useQuery({
        queryKey: ["session-stream", projectId, sessionId],
        queryFn: async () => (await querySessionStreams({sessionId, projectId}))?.[0] ?? null,
        enabled: Boolean(projectId && sessionId),
        staleTime: 30_000,
    })

    return (
        <>
            <PageTitle title={query.data?.name} />
            <SessionTabRail
                className={chatMaximized ? "md:hidden" : undefined}
                agentId={agentId ?? undefined}
                policy={{origin: "exclude-trigger", expansions: []}}
                limit={12}
                withPinned
                activeSessionId={sessionId}
                activeFallbackTitle={query.data?.name}
                menuFor={(vm) =>
                    withSessionShortcutKeys(menu.menuFor(vm), {isActive: vm.id === sessionId})
                }
                onMenuSelect={menu.onMenuSelect}
                // "Rename" and the tab's pencil open the rail's own editor; this only persists it.
                onRenameTab={menu.onRenameRow}
                // Closing drops the tab from this device's open set — never from the server.
                onClose={(vm, ordered) => closeTabs([vm.id], ordered)}
                onCloseMany={closeTabs}
                onSelect={(vm) => {
                    if (vm.id !== sessionId) void router.push(`${base}/sessions/${vm.id}`)
                }}
                // A session created here routes the same way, before the list has caught up.
                onSelectUnlisted={(id) => {
                    if (id !== sessionId) void router.push(`${base}/sessions/${id}`)
                }}
                // Starting a session needs an agent to start it with.
                // A blank session to type into — NOT the agent's overview, which is where this
                // used to land.
                onNew={agentId ? () => startBlank(agentId) : undefined}
                leadingExtra={
                    !chatMaximized && configCollapsed ? <ConfigRevealButton /> : undefined
                }
                extra={
                    <>
                        {chatMaximized ? null : (
                            <>
                                <InspectSessionButton sessionId={sessionId} />
                                <SessionHistoryMenu
                                    agentId={agentId}
                                    base={base}
                                    activeSessionId={sessionId}
                                />
                            </>
                        )}
                        {/* Shows the state and flips it; hidden below md, where the pane never mounts. */}
                        <SimpleTooltip
                            title={
                                <span className="flex items-center gap-1.5">
                                    {filesOpen ? "Hide files" : "Show files"}{" "}
                                    <ShortcutKeys id="panel.files" tone="inverse" />
                                </span>
                            }
                        >
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={filesOpen ? "Hide files pane" : "Show files pane"}
                                aria-pressed={filesOpen}
                                aria-keyshortcuts={shortcutAria("panel.files")}
                                onClick={toggleFiles}
                                // The glyph's weight carries the state; no colour shift on top.
                                className="h-7 w-7 shrink-0 p-0"
                            >
                                {/* A folder says "files" where a panel glyph wouldn't; open = pane shown. */}
                                {filesOpen ? (
                                    <FolderOpen size={14} weight="fill" />
                                ) : (
                                    <Folder size={14} />
                                )}
                            </Button>
                        </SimpleTooltip>
                    </>
                }
            />
        </>
    )
}
