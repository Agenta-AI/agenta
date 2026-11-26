import {useCallback, useState} from "react"

import {sessionStatusAtomFamily} from "@agenta/chat/state"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import chatMobileSessionsCatalog from "@agenta/i18n/catalogs/chat.mobileSessions"
import type {SessionRowVm} from "@agenta/sessions/row"
import {SessionCardList} from "@agenta/sessions-ui"
import {playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {BottomSheet, PHONE_BUTTON_CLASS} from "@agenta/ui/phone"
import {cn} from "@agenta/ui/styles"
import {Button, MENU_ITEM, Popover, PopoverContent, PopoverTrigger, Spinner} from "@agenta/ui/ui"
import {CaretDown, ListBullets, MagnifyingGlass, Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {SessionInspectorSheet} from "../chat/SessionInspectorSheet"
import {useStartBlankSession} from "../chat/useStartBlankSession"
import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {sessionMenuListArgs} from "./useAgentSessionOrder"

const MENU_ROW =
    "border-0 bg-transparent text-left font-[inherit] text-foreground hover:bg-accent focus-visible:bg-accent"

/**
 * The session menu of the session header: latest sessions, New session, Inspect session, Sessions.
 * On a phone the session button opens them in a bottom sheet, and shows the production spinner
 * while a run is active.
 */
export const SessionMenu = ({
    agentId,
    base,
    sessionId,
    title,
    loadFailed,
    onRetry,
    phone = false,
}: {
    agentId: string
    base: string
    sessionId: string
    title: string
    /** The agent's session list failed to load; "New session" still works. */
    loadFailed: boolean
    onRetry: () => void
    phone?: boolean
}) => {
    const t = useT(agentLayoutHeaderCatalog)
    const router = useRouter()
    const menu = useSessionRowMenu(base)
    const startBlank = useStartBlankSession(base)
    const [open, setOpen] = useState(false)
    // "Inspect session" lives in this menu while the debug preference is on; the sheet stays
    // outside the popover, which closes when it opens.
    const tSessions = useT(chatMobileSessionsCatalog)
    const inspectorEnabled = useAtomValue(playgroundInspectorEnabledAtom)
    const [inspecting, setInspecting] = useState(false)
    // `startBlankSession` itself ignores a second start while the first navigation runs.
    const newSession = useCallback(() => {
        setOpen(false)
        startBlank(agentId)
    }, [agentId, startBlank])

    const openRow = (vm: SessionRowVm) => {
        setOpen(false)
        if (vm.id !== sessionId) void router.push(`${base}/sessions/${vm.id}`)
    }
    const running = useAtomValue(sessionStatusAtomFamily(sessionId)) === "running"
    // Shown only while a run is live (MOTION-02); an idle session has no mark.
    const runningMark = running ? (
        <span aria-hidden data-testid="session-status-running" className="flex shrink-0 text-muted-foreground">
            <Spinner className="size-3" />
        </span>
    ) : null
    // One list for both widths: the rail's compact rows in the popover, the taller card rows
    // in the phone sheet. The row menu (rename, pin, archive) is the same on both; on a touch
    // screen the pin lives in that menu.
    const list = (density: "card" | "compact") => (
        <SessionCardList
            {...sessionMenuListArgs(agentId)}
            density={density}
            activeRowId={sessionId}
            emptyText=""
            onOpenRow={openRow}
            menuFor={menu.menuFor}
            onMenuSelect={menu.onMenuSelect}
            onRenameRow={menu.onRenameRow}
        />
    )

    const loadError = loadFailed ? (
        <div role="alert" className="flex items-center justify-between gap-2 px-2 py-1 text-meta">
            <span className="text-muted-foreground">{t("agentLayout.header.loadFailed")}</span>
            <Button variant="ghost" size="sm" className="" onClick={onRetry}>
                {t("agentLayout.header.retry")}
            </Button>
        </div>
    ) : null
    const inspector = inspectorEnabled ? (
        <SessionInspectorSheet
            sessionId={sessionId}
            open={inspecting}
            onOpenChange={setInspecting}
        />
    ) : null

    if (phone) {
        return (
            <>
                <BottomSheet
                    open={open}
                    onOpenChange={setOpen}
                    title={t("agentLayout.header.sessions")}
                    data-testid="session-sheet"
                    trigger={
                        <button
                            type="button"
                            aria-haspopup="dialog"
                            title={title}
                            className="box-border flex h-control-sm min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-control-sm border-0 bg-transparent px-2 font-[inherit] text-label text-foreground focus-ring active:bg-secondary"
                        >
                            {runningMark}
                            <span className="truncate">{title}</span>
                            <CaretDown
                                size={14}
                                aria-hidden
                                className="ag-caret shrink-0 text-muted-foreground"
                            />
                        </button>
                    }
                    actions={
                        <>
                            <Button className={PHONE_BUTTON_CLASS} onClick={newSession}>
                                <Plus size={14} />
                                {t("agentLayout.header.newSession")}
                            </Button>
                            {inspectorEnabled ? (
                                <Button
                                    variant="outline"
                                    className={PHONE_BUTTON_CLASS}
                                    onClick={() => {
                                        setOpen(false)
                                        setInspecting(true)
                                    }}
                                >
                                    {tSessions("chat.mobileSessions.inspectSession")}
                                </Button>
                            ) : null}
                            <Button variant="outline" className={PHONE_BUTTON_CLASS} asChild>
                                <Link
                                    href={`${base}/agents/${agentId}?view=sessions`}
                                    onClick={() => setOpen(false)}
                                >
                                    {t("agentLayout.header.sessions")}
                                </Link>
                            </Button>
                        </>
                    }
                >
                    {loadError}
                    <div className="px-2">{list("card")}</div>
                </BottomSheet>
                {inspector}
            </>
        )
    }

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                {/* The agent trigger's twin: ghost, 6px gaps, one caret; the session reads quieter. */}
                <Button
                    variant="ghost"
                    size="sm"
                    className="min-w-36 max-w-60 shrink gap-1.5 px-2 font-normal text-muted-foreground hover:text-foreground aria-expanded:text-foreground"
                    title={title}
                >
                    {runningMark}
                    <span className="truncate">{title}</span>
                    <CaretDown aria-hidden className="ag-caret size-3.5 shrink-0" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-80 flex-col gap-1 p-1">
                {loadError}
                <div className="ag-scroll-quiet bg-popover max-h-80 min-h-0 overflow-y-auto">
                    {list("compact")}
                </div>
                <div className="flex flex-col border-0 border-t border-solid border-border-muted pt-1">
                    {/* Menu rows, as in every menu (ROW-02). */}
                    <button type="button" className={cn(MENU_ITEM, MENU_ROW)} onClick={newSession}>
                        <Plus aria-hidden className="text-muted-foreground" />
                        {t("agentLayout.header.newSession")}
                    </button>
                    {inspectorEnabled ? (
                        <button
                            type="button"
                            className={cn(MENU_ITEM, MENU_ROW)}
                            onClick={() => {
                                setOpen(false)
                                setInspecting(true)
                            }}
                        >
                            <MagnifyingGlass aria-hidden className="text-muted-foreground" />
                            {tSessions("chat.mobileSessions.inspectSession")}
                        </button>
                    ) : null}
                    <Link
                        href={`${base}/agents/${agentId}?view=sessions`}
                        onClick={() => setOpen(false)}
                        className={cn(MENU_ITEM, MENU_ROW, "no-underline")}
                    >
                        <ListBullets aria-hidden className="text-muted-foreground" />
                        {t("agentLayout.header.sessions")}
                    </Link>
                </div>
            </PopoverContent>
            {inspector}
        </Popover>
    )
}
