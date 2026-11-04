import {useRef, useState, type ReactNode} from "react"

import {configPanelCollapsedAtom, revealConfigPaneAtom} from "@agenta/chat/state"
import {browserLiveStatusQueryAtomFamily, browserPaneOpenAtomFamily} from "@agenta/entities/browser"
import {workflowMolecule} from "@agenta/entities/workflow"
import {AgentIdentity} from "@agenta/entity-ui/agent"
import {useSessionFilesPane} from "@agenta/entity-ui/drive"
import {openAgentVersionHistoryAtom} from "@agenta/playground-ui/agent-version-history"
import {isBrowserEnabled} from "@agenta/shared/api"
import {playgroundInspectorEnabledAtom, userAtom} from "@agenta/shared/state"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
    Sheet,
    SheetContent,
    SheetTitle,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {
    BroadcastIcon,
    ChatsCircleIcon,
    ClockCounterClockwiseIcon,
    DotsThreeIcon,
    FolderIcon,
    GlobeIcon,
    KeyboardIcon,
    MagnifyingGlassIcon,
    PencilSimpleIcon,
    SidebarIcon,
    UsersIcon,
} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {canRenameSession, sessionBarPanelAtom, sessionRenameRequestAtom} from "./sessionBarState"
import {SessionInspectorSheet} from "./SessionInspectorSheet"
import {useSessionHeader} from "./useSessionHeader"

interface MoreAction {
    key: string
    label: string
    icon: ReactNode
    /** Text at the row's right edge. */
    meta?: ReactNode
    /** Registry id of the row's keycaps. */
    shortcut?: string
    onSelect: () => void
    /** The action takes focus, so it runs once the menu has handed focus back. */
    afterClose?: boolean
}

/** The session bar's overflow: a menu on a desktop, a sheet that also holds Share on a phone. */
export const SessionMoreMenu = ({
    sessionId,
    entityId,
    agentId,
    agentName,
    agentHidden,
    hasSessions,
    projectId,
    phone,
    onOpenShortcuts,
}: {
    sessionId: string
    entityId: string | null
    agentId?: string | null
    agentName: string
    agentHidden: boolean
    /** False on first run: no list to open and nothing to rename. */
    hasSessions: boolean
    projectId: string
    phone: boolean
    onOpenShortcuts: () => void
}) => {
    const [panel, setPanel] = useAtom(sessionBarPanelAtom)
    const open = panel === "more"
    const requestRename = useSetAtom(sessionRenameRequestAtom)
    const openHistory = useSetAtom(openAgentVersionHistoryAtom)
    const revealConfig = useSetAtom(revealConfigPaneAtom)
    const [configCollapsed, setConfigCollapsed] = useAtom(configPanelCollapsedAtom)
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    const me = useAtomValue(userAtom)
    const stream = useSessionHeader(projectId, sessionId).data ?? null
    const [inspectOpen, setInspectOpen] = useState(false)
    const {toggle: toggleFiles} = useSessionFilesPane(agentId ?? sessionId, sessionId)
    const browser = useAtomValue(browserLiveStatusQueryAtomFamily(sessionId)).data
    const [browserOpen, setBrowserOpen] = useAtom(browserPaneOpenAtomFamily(sessionId))

    const revisionId = entityId ?? ""
    const version = useAtomValue(workflowMolecule.selectors.data(revisionId))?.version
    const isDirty = useAtomValue(workflowMolecule.selectors.isDirty(revisionId))

    const pendingAction = useRef<(() => void) | null>(null)
    const select = (action: MoreAction) => {
        if (action.afterClose) pendingAction.current = action.onSelect
        else action.onSelect()
    }
    const onCloseAutoFocus = (event: Event) => {
        if (!pendingAction.current) return
        event.preventDefault()
        pendingAction.current()
        pendingAction.current = null
    }
    // Only ever closes this panel: the action just chosen may have opened another.
    const onOpenChange = (next: boolean) =>
        setPanel((current) => (next ? "more" : current === "more" ? null : current))

    const agentVisible = Boolean(agentId) && !agentHidden
    const canRename = hasSessions && canRenameSession(stream, me?.id)

    const session: MoreAction[] = [
        ...(entityId && agentVisible
            ? [
                  {
                      key: "version",
                      label: "Version history",
                      icon: <ClockCounterClockwiseIcon size={15} aria-hidden />,
                      meta: version != null ? `v${version} · ${isDirty ? "Draft" : "Saved"}` : null,
                      onSelect: () => openHistory(agentId as string),
                  },
              ]
            : []),
        ...(hasSessions && agentId
            ? [
                  {
                      key: "sessions",
                      label: "Search sessions",
                      icon: <ChatsCircleIcon size={15} aria-hidden />,
                      shortcut: "session.search",
                      afterClose: true,
                      onSelect: () => setPanel("switcher"),
                  },
              ]
            : []),
        ...(canRename
            ? [
                  {
                      key: "rename",
                      label: "Rename session",
                      icon: <PencilSimpleIcon size={15} aria-hidden />,
                      shortcut: "session.rename",
                      afterClose: true,
                      onSelect: () => requestRename((count) => count + 1),
                  },
              ]
            : []),
        ...(inspectorEnabled
            ? [
                  {
                      key: "inspect",
                      label: "Inspect session",
                      icon: <MagnifyingGlassIcon size={15} aria-hidden />,
                      onSelect: () => setInspectOpen(true),
                  },
              ]
            : []),
    ]
    const phoneOnly: MoreAction[] = [
        ...(entityId && !agentHidden
            ? [
                  {
                      key: "config",
                      label: configCollapsed ? "Configuration" : "Hide configuration",
                      icon: <SidebarIcon size={15} aria-hidden />,
                      onSelect: () => (configCollapsed ? revealConfig() : setConfigCollapsed(true)),
                  },
              ]
            : []),
        ...(hasSessions
            ? [
                  {
                      key: "files",
                      label: "Files",
                      icon: <FolderIcon size={15} aria-hidden />,
                      onSelect: toggleFiles,
                  },
              ]
            : []),
        ...(isBrowserEnabled() && (browser?.running || browserOpen)
            ? [
                  {
                      key: "browser",
                      label: "Browser",
                      icon: <GlobeIcon size={15} aria-hidden />,
                      meta: browser?.waiting ? "Needs you" : null,
                      onSelect: () => setBrowserOpen(!browserOpen),
                  },
              ]
            : []),
    ]
    const publish: MoreAction[] = agentVisible
        ? [
              {
                  key: "share",
                  label: "Share",
                  icon: <UsersIcon size={15} aria-hidden />,
                  onSelect: () => setPanel("share"),
              },
              {
                  key: "publish",
                  label: "Publish",
                  icon: <BroadcastIcon size={15} aria-hidden />,
                  onSelect: () => setPanel("publish"),
              },
          ]
        : []

    const inspector = inspectorEnabled ? (
        <SessionInspectorSheet
            sessionId={sessionId}
            open={inspectOpen}
            onOpenChange={setInspectOpen}
        />
    ) : null

    if (phone) {
        const row = (action: MoreAction) => (
            <button
                key={action.key}
                type="button"
                onClick={() => {
                    // Before `select`: an action may open the next panel.
                    setPanel(null)
                    select(action)
                }}
                className="active:bg-accent text-foreground flex min-h-12 w-full cursor-pointer items-center gap-3 border-0 bg-transparent px-4 text-left text-[15px] [font-family:inherit]"
            >
                <span className="text-muted-foreground flex shrink-0">{action.icon}</span>
                {action.label}
                {action.meta ? (
                    <span className="text-muted-foreground ml-auto text-[13px]">{action.meta}</span>
                ) : null}
            </button>
        )
        return (
            <>
                <Button
                    variant="ghost"
                    size="icon"
                    aria-label="More actions"
                    aria-haspopup="dialog"
                    onClick={() => setPanel("more")}
                >
                    <DotsThreeIcon weight="bold" />
                </Button>
                <Sheet open={open} onOpenChange={onOpenChange}>
                    <SheetContent
                        side="responsive"
                        aria-describedby={undefined}
                        onCloseAutoFocus={onCloseAutoFocus}
                        className="flex flex-col overflow-y-auto pb-[calc(12px+env(safe-area-inset-bottom))]"
                    >
                        <SheetTitle className="sr-only">More actions</SheetTitle>
                        {/* The bar's title only names the agent, so its edits live here. */}
                        <div className="px-4 pb-2 pt-4">
                            {agentHidden ? (
                                <span className="text-sm font-medium">{agentName}</span>
                            ) : (
                                <AgentIdentity workflowId={agentId} name={agentName} />
                            )}
                        </div>
                        {publish.map(row)}
                        {publish.length > 0 ? (
                            <div aria-hidden className="bg-border my-1.5 h-px shrink-0" />
                        ) : null}
                        {phoneOnly.map(row)}
                        {session.map(row)}
                    </SheetContent>
                </Sheet>
                {inspector}
            </>
        )
    }

    const item = (action: MoreAction) => (
        <DropdownMenuItem key={action.key} className="gap-2" onSelect={() => select(action)}>
            <span className="text-muted-foreground flex shrink-0">{action.icon}</span>
            {action.label}
            {action.meta ? (
                <span className="text-muted-foreground ml-auto pl-4 text-xs">{action.meta}</span>
            ) : null}
            {action.shortcut ? (
                <span className="ml-auto pl-4">
                    <ShortcutKeys id={action.shortcut} />
                </span>
            ) : null}
        </DropdownMenuItem>
    )

    return (
        <>
            <DropdownMenu open={open} onOpenChange={onOpenChange}>
                <SimpleTooltip title="More actions">
                    <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="More actions">
                            <DotsThreeIcon weight="bold" />
                        </Button>
                    </DropdownMenuTrigger>
                </SimpleTooltip>
                <DropdownMenuContent
                    align="end"
                    className="w-[280px]"
                    onCloseAutoFocus={onCloseAutoFocus}
                >
                    {session.map(item)}
                    {session.length > 0 ? <DropdownMenuSeparator /> : null}
                    {item({
                        key: "shortcuts",
                        label: "Keyboard shortcuts",
                        icon: <KeyboardIcon size={15} aria-hidden />,
                        shortcut: "help.sheet",
                        onSelect: onOpenShortcuts,
                    })}
                </DropdownMenuContent>
            </DropdownMenu>
            {inspector}
        </>
    )
}
