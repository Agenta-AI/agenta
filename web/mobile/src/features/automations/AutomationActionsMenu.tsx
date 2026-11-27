import {useCallback, useState} from "react"

import {type Automation, useAutomation} from "@agenta/automation-ui"
import {useAutomationDelete} from "@agenta/entity-ui/drill-in"
import {createT, useT} from "@agenta/i18n"
import automationsPanelCatalog from "@agenta/i18n/catalogs/automations.panel"
import automationsScreensCatalog from "@agenta/i18n/catalogs/automations.screens"
import {message} from "@agenta/ui/app-message"
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {ClockCounterClockwise, DotsThree, Pause, Play, Trash} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {useAutomationRunNow} from "./useAutomationRunNow"

const tNow = createT(automationsScreensCatalog)

/**
 * The automation's own actions — everything that acts on the row rather than on a field.
 *
 * A kebab, because none of these is a thing to do often and one of them is one keystroke from
 * being irreversible. Delete asks first with the "Delete this automation?" dialog (F06 f4), which
 * names the automation, so it is never a generic "are you sure".
 *
 * On a list row the kebab is the row's only control, so it also carries the three things the
 * detail screen exposes as its own controls — Run now, run history, and the on/off switch.
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
    const t = useT(automationsScreensCatalog, automationsPanelCatalog)
    const router = useRouter()
    const {remove, setActive} = useAutomation(automation.id, automation.kind)
    // The list row's Run now ignores unsaved edits: the row has none.
    const {run: onRunNow} = useAutomationRunNow(automation, base)
    const [confirmDelete, setConfirmDelete] = useState(false)

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

    // F06 f4: the dialog runs the delete, and keeps the automation when it fails.
    const onDelete = useCallback(async () => {
        await remove(automation.id)
        message.success(tNow("automations.screens.deleted"))
        const list = `${base}/automations`
        if (onLeave) onLeave(list)
        else void router.push(list).catch(() => undefined)
    }, [automation.id, base, onLeave, remove, router])
    const deletion = useAutomationDelete({onDelete, onClose: () => setConfirmDelete(false)})

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
                    >
                        {/* Bigger than the box would give it: three small dots read smaller than
                            a glyph that fills its box, so matching by measurement mismatches by
                            eye. */}
                        <DotsThree
                            aria-hidden
                            className={surface === "list" ? "size-3.5" : "size-4"}
                            weight="bold"
                        />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-popover-sm">
                    {surface === "list" ? (
                        <>
                            <DropdownMenuItem onSelect={() => void onRunNow()}>
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
                    <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete(true)}>
                        <Trash aria-hidden size={14} />
                        {t("automations.screens.delete")}
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            <AlertDialog
                open={confirmDelete}
                onOpenChange={(next) => (next ? undefined : deletion.close())}
            >
                <AlertDialogContent data-testid="automation-delete-dialog">
                    <AlertDialogHeader>
                        <AlertDialogTitle>{t("automations.screens.deleteTitle")}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {t("automations.screens.deleteMessage", {name: automation.name})}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {deletion.failed ? (
                        <p role="alert" className="m-0 text-label text-destructive">
                            {t("automations.panel.deleteFailed")}
                        </p>
                    ) : null}
                    <AlertDialogFooter>
                        {/* Focus starts on Cancel when the dialog opens. */}
                        <AlertDialogCancel asChild>
                            <Button variant="outline" disabled={deletion.pending}>
                                {t("automations.screens.cancel")}
                            </Button>
                        </AlertDialogCancel>
                        <Button
                            variant="destructive"
                            disabled={deletion.pending}
                            onClick={() => void deletion.remove()}
                        >
                            {t("automations.screens.delete")}
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    )
}
