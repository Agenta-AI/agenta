/**
 * The one place that lists every playground shortcut.
 *
 * It exists because eleven of the bindings answer no control on screen — `Alt+1…9` and the
 * `Alt+Z`/`Alt+X` pair have no button to hang a tooltip on — so a tooltip pass alone can never
 * make them discoverable. Groups and order come from the registry, so a new binding appears here
 * the moment it is declared.
 */
import {useEffect} from "react"

import {shortcutGroups} from "@agenta/shared/utils"

import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from "../components/ui"
import {cn} from "../components/ui/utils"

import {ShortcutKeys} from "./ShortcutKeys"

export interface KeyboardShortcutsSheetProps {
    open: boolean
    onOpenChange: (open: boolean) => void
    className?: string
}

export const KeyboardShortcutsSheet = ({
    open,
    onOpenChange,
    className,
}: KeyboardShortcutsSheetProps) => {
    const groups = shortcutGroups().filter((group) => group.shortcuts.length > 0)

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className={cn("max-w-[720px] p-0", className)}>
                <DialogHeader className="border-0 border-b border-solid border-colorBorderSecondary px-5 py-3.5">
                    <DialogTitle className="text-sm">Keyboard shortcuts</DialogTitle>
                    <DialogDescription className="text-xs">
                        Press ? at any time to open this list.
                    </DialogDescription>
                </DialogHeader>
                <div className="max-h-[70vh] gap-x-8 gap-y-5 overflow-y-auto px-5 pb-5 pt-4 sm:columns-2">
                    {groups.map((group) => (
                        <section key={group.id} className="mb-5 break-inside-avoid">
                            <h4 className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-colorTextTertiary">
                                {group.title}
                            </h4>
                            {group.shortcuts.map((shortcut) => (
                                <div
                                    key={shortcut.id}
                                    className="flex items-center gap-3 py-1 text-xs text-colorTextSecondary"
                                >
                                    <span className="flex-1">
                                        {shortcut.label}
                                        {shortcut.when ? (
                                            <span className="text-colorTextTertiary">
                                                {" "}
                                                — {shortcut.when}
                                            </span>
                                        ) : null}
                                    </span>
                                    <ShortcutKeys id={shortcut.id} showAlt />
                                </div>
                            ))}
                        </section>
                    ))}
                </div>
            </DialogContent>
        </Dialog>
    )
}

/**
 * Opens the sheet on `?`. Matched on `event.key`, not `event.code`: `?` is Shift+/ on a US layout,
 * Shift+ß on a German one and Shift+, on a French one, and `key` reports the produced character on
 * all three. Ignored while the caret is in a field, so typing a question mark stays a question mark.
 */
export const useShortcutsSheetHotkey = (onOpen: () => void, enabled = true) => {
    useEffect(() => {
        if (!enabled) return
        const listener = (event: KeyboardEvent) => {
            if (
                event.key !== "?" ||
                event.metaKey ||
                event.ctrlKey ||
                event.altKey ||
                event.isComposing
            )
                return
            const target = event.target as HTMLElement | null
            if (
                target &&
                (target.tagName === "INPUT" ||
                    target.tagName === "TEXTAREA" ||
                    target.isContentEditable)
            )
                return
            event.preventDefault()
            onOpen()
        }
        document.addEventListener("keydown", listener)
        return () => document.removeEventListener("keydown", listener)
    }, [onOpen, enabled])
}
