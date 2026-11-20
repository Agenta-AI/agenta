import {useCallback, useState} from "react"

import {sessionStatusAtomFamily} from "@agenta/chat/state"
import {useT} from "@agenta/i18n"
import agentLayoutHeaderCatalog from "@agenta/i18n/catalogs/agentLayout.header"
import chatMobileSessionsCatalog from "@agenta/i18n/catalogs/chat.mobileSessions"
import type {SessionRowVm} from "@agenta/sessions/row"
import {SessionCardList} from "@agenta/sessions-ui"
import {playgroundInspectorEnabledAtom} from "@agenta/shared/state"
import {
    Button,
    Popover,
    PopoverContent,
    PopoverTrigger,
    Sheet,
    SheetContent,
    SheetTitle,
} from "@agenta/ui/ui"
import {CaretDown, CaretUpDown, CircleIcon, CircleNotchIcon, Plus} from "@phosphor-icons/react"
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

    const loadError = loadFailed ? (
        <div role="alert" className="flex items-center justify-between gap-2 px-2 py-1 text-xs">
            <span className="text-colorTextSecondary">{t("agentLayout.header.loadFailed")}</span>
            <Button variant="ghost" size="sm" onClick={onRetry}>
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
                <button
                    type="button"
                    aria-haspopup="dialog"
                    title={title}
                    className="relative box-border flex h-9 min-w-0 max-w-full cursor-pointer items-center gap-2 rounded-lg border border-solid border-colorBorder bg-colorBgContainer px-2.5 font-[inherit] text-sm text-colorText after:absolute after:-inset-y-[5px] after:inset-x-0 after:content-[''] active:bg-colorFillTertiary"
                    onClick={() => setOpen(true)}
                >
                    <span aria-hidden className="flex shrink-0 text-colorTextTertiary">
                        {running ? (
                            <CircleNotchIcon size={12} className="animate-spin" />
                        ) : (
                            <CircleIcon size={10} />
                        )}
                    </span>
                    <span className="truncate">{title}</span>
                    <CaretUpDown
                        size={14}
                        aria-hidden
                        className="shrink-0 text-colorTextSecondary"
                    />
                </button>
                <Sheet open={open} onOpenChange={setOpen}>
                    <SheetContent
                        side="bottom"
                        data-testid="session-sheet"
                        aria-describedby={undefined}
                        className="max-h-[85vh] gap-0 rounded-t-2xl pb-6 pt-2"
                    >
                        <div
                            aria-hidden
                            className="mx-auto mb-2.5 h-[5px] w-9 shrink-0 rounded-full bg-colorBorder"
                        />
                        <SheetTitle className="px-4 pb-2 pt-1 text-base font-semibold">
                            {t("agentLayout.header.sessions")}
                        </SheetTitle>
                        {loadError}
                        <div className="min-h-0 flex-1 overflow-y-auto px-2">
                            <SessionCardList
                                {...sessionMenuListArgs(agentId)}
                                showAgent={false}
                                activeRowId={sessionId}
                                emptyText=""
                                onOpenRow={openRow}
                            />
                        </div>
                        <div className="flex shrink-0 flex-col gap-2 px-4 pt-2">
                            <Button
                                className="h-11 w-full gap-2 rounded-[10px] text-[15px]"
                                onClick={newSession}
                            >
                                <Plus size={14} />
                                {t("agentLayout.header.newSession")}
                            </Button>
                            {inspectorEnabled ? (
                                <Button
                                    variant="outline"
                                    className="h-11 w-full rounded-[10px] text-[15px]"
                                    onClick={() => {
                                        setOpen(false)
                                        setInspecting(true)
                                    }}
                                >
                                    {tSessions("chat.mobileSessions.inspectSession")}
                                </Button>
                            ) : null}
                        </div>
                    </SheetContent>
                </Sheet>
                {inspector}
            </>
        )
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
                {loadError}
                <div className="ag-scroll-quiet bg-popover max-h-[320px] min-h-0 overflow-y-auto">
                    <SessionCardList
                        {...sessionMenuListArgs(agentId)}
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
