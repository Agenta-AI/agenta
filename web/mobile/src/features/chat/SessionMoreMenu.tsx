import {memo, useRef, useState, type ReactNode} from "react"

import {
    chatPanelMaximizedAtom,
    configPanelCollapsedAtom,
    revealConfigPaneAtom,
} from "@agenta/chat/state"
import {workflowMolecule} from "@agenta/entities/workflow"
import {AgentIdentity} from "@agenta/entity-ui/agent"
import {useSessionFilesPane} from "@agenta/entity-ui/drive"
import {openAgentVersionHistoryAtom} from "@agenta/playground-ui/agent-version-history"
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
    KeyboardIcon,
    MagnifyingGlassIcon,
    PencilSimpleIcon,
    SidebarIcon,
    UsersIcon,
} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import {Ellipsis} from "lucide-react"

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
const SessionMoreMenuView = ({
    sessionId,
    entityId,
    agentId,
    agentName,
    agentHidden,
    hasSessions,
    projectId,
    phone,
    foldedShare = [],
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
    /** Share and Publish buttons the bar has no room for: offered at the top of the menu. */
    foldedShare?: readonly ("share" | "publish")[]
    onOpenShortcuts: () => void
}) => {
    const [panel, setPanel] = useAtom(sessionBarPanelAtom)
    const open = panel === "more"
    const requestRename = useSetAtom(sessionRenameRequestAtom)
    const openHistory = useSetAtom(openAgentVersionHistoryAtom)
    const revealConfig = useSetAtom(revealConfigPaneAtom)
    const [configCollapsed, setConfigCollapsed] = useAtom(configPanelCollapsedAtom)
    const chatMaximized = useAtomValue(chatPanelMaximizedAtom)
    const moreTriggerRef = useRef<HTMLButtonElement>(null)
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    const me = useAtomValue(userAtom)
    const stream = useSessionHeader(projectId, sessionId).data ?? null
    const [inspectOpen, setInspectOpen] = useState(false)
    const {open: filesOpen, toggle: toggleFiles} = useSessionFilesPane(
        agentId ?? sessionId,
        sessionId,
    )

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
        // Where focus returns once the action's own surface closes.
        moreTriggerRef.current?.focus()
        pendingAction.current()
        pendingAction.current = null
    }
    // Only ever closes this panel: the action just chosen may have opened another.
    const onOpenChange = (next: boolean) =>
        setPanel((current) => (next ? "more" : current === "more" ? null : current))

    const agentVisible = Boolean(agentId) && !agentHidden
    const configShown = !configCollapsed && !chatMaximized
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
        // An open Files pane outranks the configuration on a phone, so the row would do nothing.
        ...(entityId && !agentHidden && !filesOpen
            ? [
                  {
                      key: "config",
                      label: configShown ? "Hide configuration" : "Configuration",
                      icon: <SidebarIcon size={15} aria-hidden />,
                      onSelect: () => (configShown ? setConfigCollapsed(true) : revealConfig()),
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
    ]
    const publish: MoreAction[] = agentVisible
        ? [
              {
                  key: "share",
                  label: "Share",
                  icon: <UsersIcon size={15} aria-hidden />,
                  // Opened once the menu has let go of focus, or its close dismisses the panel.
                  afterClose: true,
                  onSelect: () => setPanel("share"),
              },
              {
                  key: "publish",
                  label: "Publish",
                  icon: <BroadcastIcon size={15} aria-hidden />,
                  // Opened once the menu has let go of focus, or its close dismisses the panel.
                  afterClose: true,
                  onSelect: () => setPanel("publish"),
              },
          ]
        : []

    const folded = publish.filter((action) =>
        foldedShare.includes(action.key as "share" | "publish"),
    )

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
                    ref={moreTriggerRef}
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
                        {/* The bar shows the session, so the agent's edits live here. */}
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
                        <Button
                            ref={moreTriggerRef}
                            variant="ghost"
                            size="icon-sm"
                            aria-label="More actions"
                            // The session search anchors here.
                            data-session-more-trigger=""
                        >
                            {/* Lucide's: Phosphor's reads too small beside the bar's other icons. */}
                            <Ellipsis />
                        </Button>
                    </DropdownMenuTrigger>
                </SimpleTooltip>
                <DropdownMenuContent
                    align="end"
                    className="w-[280px]"
                    onCloseAutoFocus={onCloseAutoFocus}
                >
                    {folded.map(item)}
                    {folded.length > 0 ? <DropdownMenuSeparator /> : null}
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

/** Memoized: the bar re-renders as it refits, and this part rarely changes. */
export const SessionMoreMenu = memo(SessionMoreMenuView)
