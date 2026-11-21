import {useCallback} from "react"

import {type Automation, useAutomation} from "@agenta/automation-ui"
import {getScheduleMessagePreview} from "@agenta/entities/gatewayTrigger"
import {createT, useT} from "@agenta/i18n"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {message} from "@agenta/ui/app-message"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {ClockCounterClockwise, DotsThreeVertical, Pause, Play, Trash} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {useStartTaskSession} from "../chat/useStartTaskSession"
import {useConfirmModal} from "../settings/useConfirmModal"

import {TEST_RUN_BLOCKED_TEXT, testRunBlockedReason} from "./AutomationTestRunButton"
import {runNowText} from "./runNowText"

const tNow = createT(automationsScreensCatalog)

/**
 * The automation's own actions — everything that acts on the row rather than on a field.
 *
 * A kebab, because none of these is a thing to do often and one of them is one keystroke from
 * being irreversible. Delete goes through the same confirm modal every destructive action on
 * this surface uses, and names the automation, so it is never a generic "are you sure".
 *
 * On a list row the kebab is the row's only control, so it also carries the three things the
 * detail screen exposes as its own controls — test run, run history, and the on/off switch.
 * `surface` decides which set applies, so the detail screen never offers a second copy of a
 * control already sitting beside it.
 */
export const AutomationActionsMenu = ({
    automation,
    base,
    onLeave,
    surface = "detail",
}: {
    automation: Automation
    /** `/w/:workspace/p/:project` */
    base: string
    /**
     * `"list"` adds the actions the detail screen already shows as controls of its own. On the
     * list the kebab is all a row has.
     */
    surface?: "detail" | "list"
    /**
     * Navigate past the unsaved-changes guard. A deleted automation has nothing left to save, so
     * asking about its draft would be asking about a row that no longer exists.
     */
    onLeave?: (url: string) => void
}) => {
    const t = useT(automationsScreensCatalog)
    const router = useRouter()
    const {remove, setActive} = useAutomation(automation.id, automation.kind)
    const startTask = useStartTaskSession(base)
    const {confirm, modal} = useConfirmModal()

    const onToggle = useCallback(async () => {
        const next = !automation.isActive
        try {
            await setActive(automation.id, next)
            message.success(
                next
                    ? tNow("automations.screens.switchedOn")
                    : tNow("automations.screens.switchedOff"),
            )
        } catch {
            message.error(tNow("automations.screens.changeFailed"))
        }
    }, [automation.id, automation.isActive, setActive])

    const onTestRun = useCallback(async () => {
        const instruction = getScheduleMessagePreview(automation.raw.data?.inputs_fields).trim()
        // A menu item has no disabled-with-tooltip state, so the detail button's reasons surface
        // as a toast instead.
        const blocked = testRunBlockedReason({agentId: automation.agentId, instruction})
        if (blocked !== null || !automation.agentId) {
            if (blocked !== null) message.error(tNow(TEST_RUN_BLOCKED_TEXT[blocked]))
            return
        }
        const text = await runNowText(automation)
        // Null: the deliveries call failed. Empty: the pills resolved to nothing. Either way
        // there is no message, so no session opens.
        if (!text) return
        // Sent on landing, like the detail screen's Run now.
        void startTask(automation.agentId, text)
    }, [automation, startTask])

    const onDelete = useCallback(() => {
        confirm({
            title: tNow("automations.screens.deleteTitle"),
            message: tNow("automations.screens.deleteMessage", {name: automation.name}),
            onOk: async () => {
                await remove(automation.id)
                message.success(tNow("automations.screens.deleted"))
                const list = `${base}/automations`
                if (onLeave) onLeave(list)
                else void router.push(list).catch(() => undefined)
            },
        })
    }, [automation.id, automation.name, base, confirm, onLeave, remove, router])

    return (
        <>
            <DropdownMenu>
                {/* The hover is not the default `accent`: on a list row the row itself hovers to
                    accent, so an accent button on top of it would read as no hover at all. */}
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        // A list row is a compact line and the kebab sits in a 24px column; on the
                        // detail screen it stands beside Run now and has to be that button's
                        // height, or the pair reads as one control and a smaller afterthought.
                        size={surface === "list" ? "icon-xs" : "icon-sm"}
                        variant="ghost"
                        aria-label={t("automations.screens.actionsAria")}
                        className="hover:bg-foreground/10 dark:hover:bg-foreground/15"
                    >
                        {/* Bigger than the box would give it: three small dots read smaller than
                            a glyph that fills its box, so matching by measurement mismatches by
                            eye. */}
                        <DotsThreeVertical
                            aria-hidden
                            className={surface === "list" ? "size-3.5" : "size-4"}
                            weight="bold"
                        />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px]">
                    {surface === "list" ? (
                        <>
                            <DropdownMenuItem onSelect={() => void onTestRun()}>
                                <Play aria-hidden size={14} />
                                {t("automations.screens.runNow")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() =>
                                    void router
                                        .push(`${base}/automations/${automation.id}?view=runs`)
                                        .catch(() => undefined)
                                }
                            >
                                <ClockCounterClockwise aria-hidden size={14} />
                                {/* The history is a view of the automation rather than a route,
                                    so the screen is asked to open on it. The row promises runs;
                                    landing on the config would make the reader find them. */}
                                {t("automations.screens.runHistory")}
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void onToggle()}>
                                {automation.isActive ? (
                                    <Pause aria-hidden size={14} />
                                ) : (
                                    <Play aria-hidden size={14} />
                                )}
                                {automation.isActive
                                    ? t("automations.screens.deactivate")
                                    : t("automations.screens.activate")}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                        </>
                    ) : null}
                    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                        <Trash aria-hidden size={14} />
                        {t("automations.screens.delete")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {modal}
        </>
    )
}
