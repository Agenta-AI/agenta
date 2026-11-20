/** The trigger rows' shared "⋯" actions menu (identical in both row shapes). */
import {type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import {Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from "@agenta/ui/ui"
import {DotsThree} from "@phosphor-icons/react"

export function TriggerActionsMenu({
    name,
    menu,
    open,
    container,
    phone,
}: {
    /** The automation's name: the button is "More actions for <name>". */
    name: string
    /** The composed menu body (`DropdownMenuItem` / `DropdownMenuSeparator` JSX). */
    menu: ReactNode
    /** Force open — controlled usage and forced-open parity stories. */
    open?: boolean
    /** Portal target; defaults to document.body (pass an element to render inline). */
    container?: HTMLElement | null
    /** Phone: "⋯" is 44 px; each entry is at least 44 px high. */
    phone?: boolean
}) {
    const t = useT(automationsEditorCatalog)
    return (
        <DropdownMenu open={open}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("automations.editor.moreActionsFor", {name})}
                    onClick={(e) => e.stopPropagation()}
                    className={
                        phone
                            ? "size-11 text-colorTextSecondary [&_svg]:!size-[18px]"
                            : "size-6 text-colorTextSecondary [&_svg]:!size-3.5"
                    }
                >
                    <DotsThree weight="bold" />
                </Button>
            </DropdownMenuTrigger>
            {/* Under the button, its right edge on the row's: the menu stays inside the panel. */}
            <DropdownMenuContent
                align="end"
                container={container}
                className={
                    phone
                        ? "w-[220px] [&_[role=menuitem]]:min-h-11 [&_[role=menuitem]]:text-[15px]"
                        : "w-[180px] [&_[role=menuitem]]:h-7 [&_[role=menuitem]]:text-[13px] [&_[role=menuitem]_svg]:!size-3.5"
                }
            >
                {menu}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
