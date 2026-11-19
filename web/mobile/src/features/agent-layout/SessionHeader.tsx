import {useCallback, useRef, useState} from "react"

import {SAVE_AS_TEMPLATE_MESSAGE, workflowMolecule} from "@agenta/entities/workflow"
import {AgentIdentity, useAgentActions} from "@agenta/entity-ui/agent"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import chatMobileScreenCatalog from "@agenta/i18n/catalogs/chat.mobileScreen"
import {AgentRevisionStatus} from "@agenta/playground-ui/agent-page-header"
import {openAgentVersionHistoryAtom} from "@agenta/playground-ui/agent-version-history"
import type {SessionRowVm} from "@agenta/sessions/row"
import {SessionCardList} from "@agenta/sessions-ui"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    Popover,
    PopoverContent,
    PopoverTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {
    CaretDown,
    FolderSimple,
    Hammer,
    LockSimpleIcon,
    SlidersHorizontal,
} from "@phosphor-icons/react"
import {useAtomValue, useSetAtom, useStore} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {sharingCopy} from "@/lib/sharingCopy"

import {heldCommitAtomFamily} from "../chat/selectedRevision"
import {SessionSharingControl} from "../chat/SessionSharingControl"
import {useSessionHeader} from "../chat/useSessionHeader"
import {useStartBlankSession} from "../chat/useStartBlankSession"
import {useProjectPermission} from "../context/useProjectPermission"
import {pendingTasksAtom, stashPendingTaskAtom} from "../home/pendingTask"
import {NavDrawer} from "../nav/NavDrawer"
import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {builderPanelContentAtom} from "./AgentLayout"
import {useAgentPanel} from "./agentPanelContext"
import type {PanelContent} from "./agentPanelState"

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
    const builder = useAtomValue(builderPanelContentAtom)
    const showAgentActions = Boolean(agentId) && !agentHidden

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
            {showAgentActions && entityId
                ? icon(
                      "configuration",
                      t("agentLayout.header.configuration"),
                      <SlidersHorizontal size={16} />,
                  )
                : null}
            {showAgentActions && builder
                ? icon("builder", t("agentLayout.header.builder"), <Hammer size={16} />)
                : null}
        </header>
    )
}

const AgentMenu = ({
    agentId,
    name,
    sessionId,
    canSend,
    projectId,
}: {
    agentId: string
    name: string
    sessionId: string
    canSend: boolean
    projectId: string
}) => {
    const t = useT(agentLayoutHeaderCatalog)
    const canEdit = useProjectPermission(projectId, "edit_workflows")
    const actions = useAgentActions()
    const openHistory = useSetAtom(openAgentVersionHistoryAtom)
    const store = useStore()
    const pending = useAtomValue(pendingTasksAtom)[sessionId] !== undefined
    const target = {id: agentId, name}
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={name} className="shrink-0">
                    <CaretDown size={12} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52">
                <DropdownMenuItem onSelect={() => openHistory(agentId)}>
                    {t("agentLayout.header.history")}
                </DropdownMenuItem>
                {canEdit ? (
                    <DropdownMenuItem onSelect={() => actions.rename(target)}>
                        {t("agentLayout.header.rename")}
                    </DropdownMenuItem>
                ) : null}
                {canSend ? (
                    <DropdownMenuItem
                        disabled={pending}
                        onSelect={() => {
                            // Production "Save as template": the agent builds the download.
                            if (store.get(pendingTasksAtom)[sessionId]) return
                            store.set(stashPendingTaskAtom, {
                                sessionId,
                                task: {agentId, text: SAVE_AS_TEMPLATE_MESSAGE},
                            })
                        }}
                    >
                        {t("agentLayout.header.exportAgent")}
                    </DropdownMenuItem>
                ) : null}
                {canEdit ? (
                    <DropdownMenuItem onSelect={() => actions.remove(target)}>
                        {t("agentLayout.header.archiveAgent")}
                    </DropdownMenuItem>
                ) : null}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

const SessionMenu = ({
    agentId,
    base,
    sessionId,
    title,
}: {
    agentId: string
    base: string
    sessionId: string
    title: string
}) => {
    const t = useT(agentLayoutHeaderCatalog)
    const router = useRouter()
    const menu = useSessionRowMenu(base)
    const startBlank = useStartBlankSession(base)
    const [open, setOpen] = useState(false)
    // A second "New session" while the first navigation runs starts nothing.
    const starting = useRef(false)
    const newSession = useCallback(() => {
        if (starting.current) return
        starting.current = true
        setOpen(false)
        startBlank(agentId)
        setTimeout(() => (starting.current = false), 1000)
    }, [agentId, startBlank])

    const openRow = (vm: SessionRowVm) => {
        setOpen(false)
        if (vm.id !== sessionId) void router.push(`${base}/sessions/${vm.id}`)
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button
                    variant="ghost"
                    className="h-8 min-w-0 max-w-[240px] gap-1 px-2 text-sm max-md:h-11"
                    title={title}
                >
                    <span className="truncate">{title}</span>
                    <CaretDown size={12} className="shrink-0" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-[320px] flex-col gap-1 p-2">
                <div className="ag-scroll-quiet bg-popover max-h-[320px] min-h-0 overflow-y-auto">
                    <SessionCardList
                        agentId={agentId}
                        policy={{origin: "exclude-trigger", expansions: []}}
                        limit={20}
                        withPinned
                        density="compact"
                        activeRowId={sessionId}
                        emptyText=""
                        onOpenRow={openRow}
                        menuFor={menu.menuFor}
                        onMenuSelect={menu.onMenuSelect}
                        onRenameRow={menu.onRenameRow}
                    />
                </div>
                <div className="flex flex-col border-0 border-t border-solid border-colorBorderSecondary pt-1">
                    <Button variant="ghost" className="justify-start" onClick={newSession}>
                        {t("agentLayout.header.newSession")}
                    </Button>
                    <Button variant="ghost" className="justify-start" asChild>
                        <Link
                            href={`${base}/agents/${agentId}?view=sessions`}
                            onClick={() => setOpen(false)}
                        >
                            {t("agentLayout.header.sessions")}
                        </Link>
                    </Button>
                </div>
            </PopoverContent>
        </Popover>
    )
}
