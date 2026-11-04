import {useEffect, useRef} from "react"

import {sessionRowVm} from "@agenta/sessions/row"
import {InlineRenameInput, useInlineRename} from "@agenta/sessions-ui"
import {userAtom} from "@agenta/shared/state"
import {ShortcutKeys} from "@agenta/ui/shortcuts"
import {
    Button,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Sheet,
    SheetContent,
    SheetTitle,
    SimpleTooltip,
    SkeletonBlock,
} from "@agenta/ui/ui"
import {CaretDownIcon, PlusIcon} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"

import {PageTitle} from "@/components/PageTitle"

import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {canRenameSession, sessionBarPanelAtom, sessionRenameRequestAtom} from "./sessionBarState"
import {SessionOrderPublisher} from "./SessionOrderPublisher"
import {SessionSwitcherPanel} from "./SessionSwitcherPanel"
import {useSessionHeader} from "./useSessionHeader"
import {useStartBlankSession} from "./useStartBlankSession"

const RENAME_INPUT =
    "border-border bg-background text-foreground focus:border-primary box-border h-control-sm min-w-0 flex-1 rounded-control-sm border border-solid px-2 text-sm outline-none [font-family:inherit]"

/**
 * Which session is on screen, and the way to any other: a trigger that opens this agent's list,
 * with New session beside it. On a phone the trigger is the bar's title and the list a sheet.
 */
export const SessionSwitcher = ({
    sessionId,
    agentId,
    agentResolving,
    agentName,
    workspaceId,
    projectId,
    phone,
}: {
    sessionId: string
    agentId?: string | null
    /** A null `agentId` is not yet the answer. */
    agentResolving: boolean
    /** The title's second line on a phone. */
    agentName: string
    workspaceId: string
    projectId: string
    phone: boolean
}) => {
    const base = `/w/${workspaceId}/p/${projectId}`
    const me = useAtomValue(userAtom)
    const menu = useSessionRowMenu(base)
    const startBlank = useStartBlankSession(base)
    const header = useSessionHeader(projectId, sessionId)
    const stream = header.data ?? null
    const [panel, setPanel] = useAtom(sessionBarPanelAtom)
    // Held back while resolving: an unscoped list would show the whole project, then re-key.
    const open = panel === "switcher" && (Boolean(agentId) || !agentResolving)
    const close = () => setPanel(null)
    const onNew = agentId ? () => startBlank(agentId) : undefined

    const title = stream
        ? sessionRowVm(stream, {pinned: false, pending: undefined}).title
        : "New session"
    const canRename = canRenameSession(stream, me?.id)
    const rename = useInlineRename({
        current: stream?.name ?? title,
        onCommit: async (name) => (stream ? menu.onRenameStream(stream, name) : false),
    })

    // Raised outside this component, so it arrives as a count; only a new count starts an edit.
    const renameRequest = useAtomValue(sessionRenameRequestAtom)
    const seenRequest = useRef(renameRequest)
    const {start: startRename, cancel: cancelRename} = rename
    // This component outlives a session switch: a draft must not land on the next session.
    useEffect(() => cancelRename, [cancelRename, sessionId])
    useEffect(() => {
        if (seenRequest.current === renameRequest) return
        seenRequest.current = renameRequest
        if (canRename) startRename()
    }, [canRename, renameRequest, startRename])

    // Opened from the composer with `Alt+K`, closing hands the caret back to it.
    const searchRef = useRef<HTMLInputElement>(null)
    const focusBeforeOpen = useRef<HTMLElement | null>(null)

    const panelBody = (
        <SessionSwitcherPanel
            agentId={agentId}
            base={base}
            activeSessionId={sessionId}
            onNew={onNew}
            onClose={close}
            searchRef={searchRef}
        />
    )
    const label = header.isPending ? (
        <SkeletonBlock active className="h-3.5 w-32" />
    ) : (
        <span className="min-w-0 max-w-[200px] truncate lg:max-w-[240px]">{title}</span>
    )
    const order = agentId || !agentResolving ? <SessionOrderPublisher agentId={agentId} /> : null

    if (phone) {
        return (
            <>
                <PageTitle title={stream?.name} />
                {order}
                {rename.renaming ? (
                    <span className="flex h-9 min-w-0 flex-1 px-1">
                        <InlineRenameInput rename={rename} className={RENAME_INPUT} />
                    </span>
                ) : (
                    <button
                        type="button"
                        aria-haspopup="dialog"
                        aria-expanded={open}
                        aria-label={`${title}, switch session`}
                        onClick={() => setPanel("switcher")}
                        className="active:bg-accent text-foreground flex h-11 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-px rounded-control border-0 bg-transparent px-1.5 [font-family:inherit]"
                    >
                        <span className="flex max-w-full min-w-0 items-center gap-1 text-[15px] font-semibold leading-5">
                            {label}
                            <CaretDownIcon
                                size={12}
                                aria-hidden
                                className="text-muted-foreground shrink-0"
                            />
                        </span>
                        <span className="text-muted-foreground max-w-full truncate text-xs leading-[15px]">
                            {agentName}
                        </span>
                    </button>
                )}
                <Sheet open={open} onOpenChange={(next) => setPanel(next ? "switcher" : null)}>
                    <SheetContent
                        side="responsive"
                        aria-describedby={undefined}
                        onOpenAutoFocus={(event) => event.preventDefault()}
                        className="flex flex-col pb-[env(safe-area-inset-bottom)]"
                    >
                        <SheetTitle className="px-4 pb-1 pt-4 text-base">Sessions</SheetTitle>
                        {panelBody}
                    </SheetContent>
                </Sheet>
            </>
        )
    }

    return (
        <>
            <PageTitle title={stream?.name} />
            {order}
            <Popover open={open} onOpenChange={(next) => setPanel(next ? "switcher" : null)}>
                <div className="flex items-center gap-1">
                    {rename.renaming ? (
                        <span className="flex w-[200px] lg:w-[260px]">
                            <InlineRenameInput rename={rename} className={RENAME_INPUT} />
                        </span>
                    ) : (
                        <PopoverTrigger asChild>
                            <Button
                                variant="outline"
                                size="sm"
                                aria-label={`${title}, switch session`}
                            >
                                {label}
                                <CaretDownIcon data-icon="inline-end" aria-hidden />
                            </Button>
                        </PopoverTrigger>
                    )}
                    {onNew ? (
                        <SimpleTooltip
                            title={
                                <span className="flex items-center gap-1.5">
                                    New session <ShortcutKeys id="session.new" tone="inverse" />
                                </span>
                            }
                        >
                            <Button
                                variant="outline"
                                size="icon-sm"
                                aria-label="New session"
                                onClick={onNew}
                            >
                                <PlusIcon />
                            </Button>
                        </SimpleTooltip>
                    ) : null}
                </div>
                <PopoverContent
                    align="center"
                    aria-label="Sessions"
                    className="w-[360px] overflow-hidden p-0"
                    onOpenAutoFocus={(event) => {
                        event.preventDefault()
                        focusBeforeOpen.current = document.activeElement as HTMLElement | null
                        searchRef.current?.focus()
                    }}
                    onInteractOutside={() => {
                        focusBeforeOpen.current = null
                    }}
                    onCloseAutoFocus={(event) => {
                        const previous = focusBeforeOpen.current
                        if (!previous?.isConnected || previous === document.body) return
                        event.preventDefault()
                        previous.focus()
                    }}
                >
                    {panelBody}
                </PopoverContent>
            </Popover>
        </>
    )
}
