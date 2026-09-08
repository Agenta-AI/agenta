import {useCallback, useState} from "react"

import {type TriggerSubscription} from "@agenta/entities/gatewayTrigger"
import {message} from "@agenta/ui/app-message"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Copy, DotsThree, Hash, Trash} from "@phosphor-icons/react"
import {useRouter} from "next/router"

import {Button} from "@/components/ui/button"

import {useConfirmSheet} from "../settings/useConfirmSheet"

import {buildAutomationCreate} from "./automationEdit"
import {automationInputsFields, type Automation} from "./automationModel"
import {useAutomation} from "./useAutomation"

/**
 * The automation's own actions — everything that acts on the row rather than on a field.
 *
 * A kebab, because none of these is a thing to do often and two of them are one keystroke from
 * being irreversible. Delete goes through the same confirm sheet every destructive action on this
 * surface uses, and names the automation, so the sheet is never a generic "are you sure".
 *
 * A duplicate arrives OFF. Copying a schedule that runs at 09:00 should not add a second 09:00 run
 * nobody asked for; the copy opens ready to be edited and switched on.
 */
export const AutomationActionsMenu = ({
    automation,
    base,
    onLeave,
}: {
    automation: Automation
    /** `/w/:workspace/p/:project` */
    base: string
    /**
     * Navigate past the unsaved-changes guard. A deleted automation has nothing left to save, so
     * asking about its draft would be asking about a row that no longer exists.
     */
    onLeave?: (url: string) => void
}) => {
    const router = useRouter()
    const {create, remove} = useAutomation(automation.id, automation.kind)
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
            void router.push(`${base}/automations/${copy.id}`).catch(() => {})
        } catch {
            message.error("Couldn't duplicate this automation")
        } finally {
            setDuplicating(false)
        }
    }, [automation, base, create, duplicating, router])

    const onCopyId = useCallback(async () => {
        try {
            // `navigator.clipboard` is undefined outside a secure context.
            await navigator.clipboard.writeText(automation.id)
            message.success("Automation ID copied")
        } catch {
            message.error("Couldn't copy the ID")
        }
    }, [automation.id])

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
                else void router.push(list).catch(() => {})
            },
        })
    }, [automation.id, automation.name, base, confirm, onLeave, remove, router])

    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button
                        type="button"
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Automation actions"
                    >
                        <DotsThree aria-hidden size={18} weight="bold" />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-[220px]">
                    <DropdownMenuItem disabled={duplicating} onSelect={() => void onDuplicate()}>
                        <Copy aria-hidden size={14} />
                        Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => void onCopyId()}>
                        <Hash aria-hidden size={14} />
                        Copy automation ID
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
