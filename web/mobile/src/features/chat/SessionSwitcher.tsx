import {useEffect, useRef} from "react"

import {AGENT_CHIP_BOX, AGENT_CHIP_FALLBACK, useAgentIconChrome} from "@agenta/entity-ui/agent"
import {sessionRowVm} from "@agenta/sessions/row"
import {
    InlineRenameInput,
    SessionTabRail,
    SessionTabStrip,
    sessionMenuAccess,
    useInlineRename,
    useRequestSessionTabRename,
    withSessionShortcutKeys,
} from "@agenta/sessions-ui"
import {userAtom} from "@agenta/shared/state"
import {Popover, PopoverAnchor, PopoverContent, PopoverTrigger, SkeletonBlock} from "@agenta/ui/ui"
import {CaretDownIcon, RobotIcon} from "@phosphor-icons/react"
import {useAtom, useAtomValue} from "jotai"
import {useRouter} from "next/router"

import {PageTitle} from "@/components/PageTitle"

import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {canRenameSession, sessionBarPanelAtom, sessionRenameRequestAtom} from "./sessionBarState"
import {SessionOrderPublisher} from "./SessionOrderPublisher"
import {SessionSwitcherPanel} from "./SessionSwitcherPanel"
import {useSessionHeader} from "./useSessionHeader"
import {useSessionTabClose} from "./useSessionTabClose"
import {useStartBlankSession} from "./useStartBlankSession"

const RENAME_INPUT =
    "border-border bg-background text-foreground focus:border-primary box-border h-control-sm min-w-0 flex-1 rounded-control-sm border border-solid px-2 text-sm outline-none [font-family:inherit]"

/**
 * Which session is on screen, and the way to any other: a rail of this agent's sessions. `Alt+K`
 * and the ⋯ menu open a search for the rest. On a phone the bar's title opens that search.
 */
export const SessionSwitcher = ({
    sessionId,
    agentId,
    agentResolving,
    agentName,
    agentHidden,
    workspaceId,
    projectId,
    phone,
}: {
    sessionId: string
    agentId?: string | null
    /** A null `agentId` is not yet the answer. */
    agentResolving: boolean
    agentName: string
    /** A private agent the reader cannot see: the phone title shows the plain chip. */
    agentHidden: boolean
    workspaceId: string
    projectId: string
    phone: boolean
}) => {
    const base = `/w/${workspaceId}/p/${projectId}`
    const me = useAtomValue(userAtom)
    const chip = useAgentIconChrome(agentHidden ? null : agentId, {
        size: 13,
        fallbackGlyph: <RobotIcon size={15} />,
        fallbackClassName: AGENT_CHIP_FALLBACK,
    })
    const menu = useSessionRowMenu(base)
    const startBlank = useStartBlankSession(base)
    const router = useRouter()
    const closeTabs = useSessionTabClose({agentId, sessionId, base})
    const header = useSessionHeader(projectId, sessionId)
    const stream = header.data ?? null
    const [panel, setPanel] = useAtom(sessionBarPanelAtom)
    // Held back while resolving: an unscoped list would show the whole project, then re-key.
    const open = panel === "switcher" && (Boolean(agentId) || !agentResolving)
    const close = () => setPanel(null)
    // Only ever closes this panel: another may have opened on the same press.
    const onOpenChange = (next: boolean) =>
        setPanel((current) => (next ? "switcher" : current === "switcher" ? null : current))
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
    const requestTabRename = useRequestSessionTabRename()
    const seenRequest = useRef(renameRequest)
    const {start: startRename, cancel: cancelRename} = rename
    // This component outlives a session switch: a draft must not land on the next session.
    useEffect(() => cancelRename, [cancelRename, sessionId])
    useEffect(() => {
        if (seenRequest.current === renameRequest) return
        seenRequest.current = renameRequest
        if (!canRename) return
        if (phone) startRename()
        else requestTabRename(sessionId)
    }, [canRename, phone, renameRequest, requestTabRename, sessionId, startRename])

    // Opened from the composer with `Alt+K`, closing hands the caret back to it.
    const searchRef = useRef<HTMLInputElement>(null)
    const focusBeforeOpen = useRef<HTMLElement | null>(null)

    const sessionsPanel = (
        <PopoverContent
            align={phone ? "start" : "end"}
            collisionPadding={8}
            aria-label="Sessions"
            className={`${phone ? "w-[calc(100vw-16px)]" : "w-[360px]"} overflow-hidden p-0`}
            onOpenAutoFocus={(event) => {
                event.preventDefault()
                focusBeforeOpen.current = document.activeElement as HTMLElement | null
                // A phone keeps its keyboard down until the person taps the search.
                if (!phone) searchRef.current?.focus()
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
            <SessionSwitcherPanel
                agentId={agentId}
                base={base}
                activeSessionId={sessionId}
                onNew={onNew}
                onClose={close}
                searchRef={searchRef}
            />
        </PopoverContent>
    )
    const label = header.isPending ? (
        <SkeletonBlock active className="h-3.5 w-32" />
    ) : (
        <span className="min-w-0 max-w-[200px] truncate lg:max-w-[240px]">{title}</span>
    )
    const order = agentId || !agentResolving ? <SessionOrderPublisher agentId={agentId} /> : null
    const openSession = (id: string) => {
        if (id !== sessionId) void router.push(`${base}/sessions/${id}`)
    }

    if (phone) {
        return (
            <>
                <PageTitle title={stream?.name} />
                {order}
                <Popover open={open} onOpenChange={onOpenChange}>
                    {rename.renaming ? (
                        <span className="flex h-9 min-w-0 flex-1 px-1">
                            <InlineRenameInput rename={rename} className={RENAME_INPUT} />
                        </span>
                    ) : (
                        <PopoverTrigger asChild>
                            <button
                                type="button"
                                aria-label={`${title} in ${agentName}, switch session`}
                                className="active:bg-accent text-foreground flex h-10 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-1.5 text-sm font-semibold [font-family:inherit]"
                            >
                                <span
                                    aria-hidden
                                    className={`${AGENT_CHIP_BOX} ${chip.className}`}
                                    style={chip.style}
                                >
                                    {chip.glyph}
                                </span>
                                {label}
                                <CaretDownIcon
                                    size={12}
                                    aria-hidden
                                    className="text-muted-foreground shrink-0"
                                />
                            </button>
                        </PopoverTrigger>
                    )}
                    {sessionsPanel}
                </Popover>
            </>
        )
    }

    return (
        <>
            <PageTitle title={stream?.name} />
            <Popover open={open} onOpenChange={onOpenChange}>
                <PopoverAnchor asChild>
                    {/* Two tabs, three from `xl`: each is 180px plus a 2px gap, and 12px of room
                        at each end. `-mb-px` lowers the tabs onto the bar's page line. */}
                    <div className="-mb-px flex w-[388px] min-w-0 self-stretch xl:w-[570px]">
                        {agentId || !agentResolving ? (
                            <SessionTabRail
                                bare
                                agentId={agentId ?? undefined}
                                policy={{origin: "exclude-trigger", expansions: []}}
                                limit={12}
                                withPinned
                                lowPriority
                                activeSessionId={sessionId}
                                activeFallbackTitle={stream?.name}
                                menuFor={(vm) =>
                                    withSessionShortcutKeys(menu.menuFor(vm), {
                                        isActive: vm.id === sessionId,
                                    })
                                }
                                onMenuSelect={menu.onMenuSelect}
                                onRenameTab={menu.onRenameRow}
                                canRenameTab={(vm) =>
                                    sessionMenuAccess(
                                        {ownerUserId: vm.stream.owner_user_id ?? null},
                                        me?.id,
                                    ) !== "member"
                                }
                                onClose={(vm, ordered) => closeTabs([vm.id], ordered)}
                                onCloseMany={closeTabs}
                                onSelect={(vm) => openSession(vm.id)}
                                onSelectUnlisted={openSession}
                            />
                        ) : (
                            <SessionTabStrip bare />
                        )}
                    </div>
                </PopoverAnchor>
                {sessionsPanel}
            </Popover>
        </>
    )
}
