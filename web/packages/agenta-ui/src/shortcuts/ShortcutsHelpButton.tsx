/**
 * The visible way into the shortcuts sheet, and the owner of the `?` hotkey.
 *
 * A hotkey with no button teaches nobody, so the two ship together: this sits at the right edge of
 * the playground top bar, and pressing `?` anywhere outside a text field opens the same sheet.
 * Linear pairs `?` with a Help entry in its sidebar for the same reason.
 */
import {useCallback, useState} from "react"

import {shortcutAria} from "@agenta/shared/utils"
import {Keyboard} from "@phosphor-icons/react"

import {Button, SimpleTooltip} from "../components/ui"

import {KeyboardShortcutsSheet, useShortcutsSheetHotkey} from "./KeyboardShortcutsSheet"
import {ShortcutKeys} from "./ShortcutKeys"

export interface ShortcutsHelpButtonProps {
    /** Turn the `?` hotkey off where a host binds it itself. The button still works. */
    hotkey?: boolean
    className?: string
}

export const ShortcutsHelpButton = ({
    hotkey = true,
    className = "h-7 w-7 shrink-0 p-0",
}: ShortcutsHelpButtonProps) => {
    const [open, setOpen] = useState(false)
    useShortcutsSheetHotkey(
        useCallback(() => setOpen(true), []),
        hotkey,
    )

    return (
        <>
            <SimpleTooltip
                title={
                    <span className="flex items-center gap-1.5">
                        Keyboard shortcuts <ShortcutKeys id="help.sheet" tone="inverse" />
                    </span>
                }
            >
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Keyboard shortcuts"
                    aria-keyshortcuts={shortcutAria("help.sheet")}
                    onClick={() => setOpen(true)}
                    className={className}
                >
                    <Keyboard size={14} />
                </Button>
            </SimpleTooltip>
            <KeyboardShortcutsSheet open={open} onOpenChange={setOpen} />
        </>
    )
}
