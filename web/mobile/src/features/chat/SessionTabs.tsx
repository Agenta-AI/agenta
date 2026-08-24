import {chatPanelMaximizedAtom, configPanelCollapsedAtom} from "@agenta/chat/state"
import {querySessionStreams} from "@agenta/entities/session"
import {useSessionFilesPane} from "@agenta/entity-ui/drive"
import {SessionTabRail} from "@agenta/sessions-ui"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {useQuery} from "@tanstack/react-query"
import {useAtom, useAtomValue} from "jotai"
import {ChevronsLeft, ChevronsRight} from "lucide-react"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"

import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {SessionHistoryMenu} from "./SessionHistoryMenu"
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
    const [configCollapsed, setConfigCollapsed] = useAtom(configPanelCollapsedAtom)
    const {open: filesOpen, openPane} = useSessionFilesPane(agentId ?? sessionId, sessionId)
    // The singular GET /sessions/streams redirects with a root-path-less Location
    // behind the /api prefix and lands on the web app — use the proven query POST.
    const query = useQuery({
        queryKey: ["mobile", "session-stream", projectId, sessionId],
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
                menuFor={menu.menuFor}
                onMenuSelect={menu.onMenuSelect}
                onSelect={(vm) => {
                    if (vm.id !== sessionId) void router.push(`${base}/sessions/${vm.id}`)
                }}
                // Starting a session needs an agent to start it with.
                // A blank session to type into — NOT the agent's overview, which is where this
                // used to land.
                onNew={agentId ? () => startBlank(agentId) : undefined}
                leadingExtra={
                    !chatMaximized && configCollapsed ? (
                        <SimpleTooltip title="Show configuration">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label="Show configuration"
                                onClick={() => setConfigCollapsed(false)}
                                className="h-7 w-7 shrink-0 p-0"
                            >
                                <ChevronsRight size={14} />
                            </Button>
                        </SimpleTooltip>
                    ) : undefined
                }
                extra={
                    chatMaximized ? undefined : (
                        <>
                            {/* Same slot and order as the desktop bar: history, then the files
                                opener at the right edge the pane expands from. */}
                            <SessionHistoryMenu
                                agentId={agentId}
                                base={base}
                                activeSessionId={sessionId}
                            />
                            {filesOpen ? null : (
                                <SimpleTooltip title="Show files" side="left">
                                    <Button
                                        variant="ghost"
                                        size="icon-sm"
                                        aria-label="Show files pane"
                                        onClick={openPane}
                                        className="h-7 w-7 shrink-0 p-0"
                                    >
                                        <ChevronsLeft size={14} />
                                    </Button>
                                </SimpleTooltip>
                            )}
                        </>
                    )
                }
            />
        </>
    )
}
