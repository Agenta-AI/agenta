import {useCallback, useState} from "react"

import {
    type Automation,
    automationInputsFields,
    buildAutomationCreate,
    useAutomation,
} from "@agenta/automation-ui"
import {getScheduleMessagePreview, type TriggerSubscription} from "@agenta/entities/gatewayTrigger"
import {message} from "@agenta/ui/app-message"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    ClockCounterClockwise,
    Copy,
    DotsThreeVertical,
    Pause,
    Play,
    Trash,
} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {Button} from "@/components/ui/button"

import {useStartBlankSession} from "../chat/useStartBlankSession"
import {useConfirmSheet} from "../settings/useConfirmSheet"

/**
 * The automation's own actions — everything that acts on the row rather than on a field.
 *
 * A kebab, because none of these is a thing to do often and two of them are one keystroke from
 * being irreversible. Delete goes through the same confirm sheet every destructive action on this
 * surface uses, and names the automation, so the sheet is never a generic "are you sure".
 *
 * A duplicate arrives OFF. Copying a schedule that runs at 09:00 should not add a second 09:00 run
 * nobody asked for; the copy opens ready to be edited and switched on.
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
    const router = useRouter()
    const {create, remove, setActive} = useAutomation(automation.id, automation.kind)
    const startSession = useStartBlankSession(base)
    const {confirm, sheet} = useConfirmSheet()
    const [duplicating, setDuplicating] = useState(false)

    const onDuplicate = useCallback(async () => {
        if (duplicating) return
        setDuplicating(true)
        try {
            const copy = await create(
                buildAutomationCreate(
                    {
                        kind: automation.kind,
                        name: `${automation.name} (copy)`,
                        description: automation.description,
                        cron: automation.cron ?? "",
                        eventKey: automation.eventKey,
                        connectionId: automation.connectionId,
                        triggerConfig:
                            (automation.raw as TriggerSubscription).data?.trigger_config ??
                            undefined,
                        inputsFields: automationInputsFields(automation),
                        isActive: false,
                    },
                    // The same agent, bound the same way — a copy that runs a different agent
                    // than the thing it was copied from is not a copy.
                    automation.raw.data?.references,
                ),
            )
            if (!copy?.id) {
                message.error("Couldn't duplicate this automation")
                return
            }
            message.success("Duplicated — the copy is off until you switch it on")
            // Not awaited inside the try: unsaved edits here make the guard abort this push, and
            // that abort is not a failed duplicate.
            void router.push(`${base}/automations/${copy.id}`).catch(() => undefined)
        } catch {
            message.error("Couldn't duplicate this automation")
        } finally {
            setDuplicating(false)
        }
    }, [automation, base, create, duplicating, router])

    const onToggle = useCallback(async () => {
        const next = !automation.isActive
        try {
            await setActive(automation.id, next)
            message.success(next ? "Automation switched on" : "Automation switched off")
        } catch {
            message.error("Couldn't change this automation")
        }
    }, [automation.id, automation.isActive, setActive])

    const onTestRun = useCallback(() => {
        if (!automation.agentId) {
            message.error("Pick the agent this automation runs first")
            return
        }
        // Unsent, like the detail screen's Test run: a rehearsal leaves the last press to the user.
        startSession(automation.agentId, {
            draft: getScheduleMessagePreview(automation.raw.data?.inputs_fields),
        })
    }, [automation.agentId, automation.raw.data?.inputs_fields, startSession])

    const onDelete = useCallback(() => {
        confirm({
            title: "Delete this automation?",
            message:
                `“${automation.name}” stops running and leaves your list. ` +
                "Its past runs stay in your history.",
            onOk: async () => {
                await remove(automation.id)
                message.success("Automation deleted")
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
                        // detail screen it stands beside Test run and has to be that button's
                        // height, or the pair reads as one control and a smaller afterthought.
                        size={surface === "list" ? "icon-xs" : "icon-sm"}
                        variant="ghost"
                        aria-label="Automation actions"
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
                            <DropdownMenuItem onSelect={onTestRun}>
                                <Play aria-hidden size={14} />
                                Test run in playground
                            </DropdownMenuItem>
                            <DropdownMenuItem
                                onSelect={() =>
                                    void router
                                        .push(`${base}/automations/${automation.id}`)
                                        .catch(() => undefined)
                                }
                            >
                                <ClockCounterClockwise aria-hidden size={14} />
                                {/* The history lives on the automation now, so this is the
                                    automation's own screen rather than a page of its own. */}
                                View run history
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => void onToggle()}>
                                {automation.isActive ? (
                                    <Pause aria-hidden size={14} />
                                ) : (
                                    <Play aria-hidden size={14} />
                                )}
                                {automation.isActive ? "Turn off" : "Turn on"}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                        </>
                    ) : null}
                    <DropdownMenuItem disabled={duplicating} onSelect={() => void onDuplicate()}>
                        <Copy aria-hidden size={14} />
                        Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={onDelete}>
                        <Trash aria-hidden size={14} />
                        Delete automation
                    </DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {sheet}
        </>
    )
}
