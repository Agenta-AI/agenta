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
import {Button, Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import {CaretUpDown, CircleNotchIcon, Plus} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"

import {SessionInspectorSheet} from "../chat/SessionInspectorSheet"
import {useStartBlankSession} from "../chat/useStartBlankSession"
import {useSessionRowMenu} from "../sessions/useSessionRowMenu"

import {sessionMenuListArgs} from "./useAgentSessionOrder"

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
    // The session's status: a ring, filled while a run is active.
    const statusDot = (
        <span
            aria-hidden
            data-testid="session-status-dot"
            className={cn(
                "mx-0.5 box-border size-2 shrink-0 rounded-full border-[1.25px] border-solid",
                running ? "border-colorText bg-colorText" : "border-colorTextTertiary",
            )}
        />
    )
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
        <div role="alert" className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
            <span className="text-colorTextSecondary">{t("agentLayout.header.loadFailed")}</span>
            <Button variant="ghost" size="sm" className="max-md:h-11" onClick={onRetry}>
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
                            className="relative box-border flex h-9 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-solid border-colorBorder bg-colorBgContainer px-2.5 font-[inherit] text-sm font-medium leading-5 text-colorText after:absolute after:-inset-y-[5px] after:inset-x-0 after:content-[''] active:bg-colorFillTertiary"
                        >
                            {running ? (
                                <span aria-hidden className="flex shrink-0 text-colorTextTertiary">
                                    <CircleNotchIcon size={12} className="animate-spin" />
                                </span>
                            ) : (
                                statusDot
                            )}
                            <span className="truncate">{title}</span>
                            <CaretUpDown
                                size={14}
                                aria-hidden
                                className="shrink-0 text-colorTextSecondary"
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
                <Button
                    variant="outline"
                    className="h-7 min-w-0 max-w-[240px] gap-2 rounded-md pl-2.5 pr-2 text-[13px] font-medium max-md:h-11"
                    title={title}
                >
                    {statusDot}
                    <span className="truncate">{title}</span>
                    <CaretUpDown aria-hidden className="size-3.5 shrink-0 text-colorTextTertiary" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-[320px] flex-col gap-1 p-2">
                {loadError}
                <div className="ag-scroll-quiet bg-popover max-h-[320px] min-h-0 overflow-y-auto">
                    {list("compact")}
                </div>
                <div className="flex flex-col border-0 border-t border-solid border-colorBorderSecondary pt-1">
                    <Button variant="ghost" className="justify-start" onClick={newSession}>
                        {t("agentLayout.header.newSession")}
                    </Button>
                    {inspectorEnabled ? (
                        <Button
                            variant="ghost"
                            className="justify-start"
                            onClick={() => {
                                setOpen(false)
                                setInspecting(true)
                            }}
                        >
                            {tSessions("chat.mobileSessions.inspectSession")}
                        </Button>
                    ) : null}
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
            {inspector}
        </Popover>
    )
}
