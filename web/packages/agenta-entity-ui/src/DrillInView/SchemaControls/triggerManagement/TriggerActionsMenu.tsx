/** The trigger rows' shared "⋯" actions menu (identical in both row shapes). */
import {type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import automationsEditorCatalog from "@agenta/i18n/catalogs/automations.editor"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import {SimpleTooltip} from "@agenta/ui/composed"
import {Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from "@agenta/ui/ui"
import {DotsThreeVertical} from "@phosphor-icons/react"

export function TriggerActionsMenu({
    name,
    menu,
    open,
    container,
}: {
    /** The automation's name: the button is "More actions for <name>". */
    name: string
    /** The composed menu body (`DropdownMenuItem` JSX). */
    menu: ReactNode
    /** Force open — controlled usage and forced-open parity stories. */
    open?: boolean
    /** Portal target; defaults to document.body (pass an element to render inline). */
    container?: HTMLElement | null
    /** Kept for callers; the menu has one size on every screen (SIZE-02). */
    phone?: boolean
}) {
    const t = useT(automationsEditorCatalog, uiControlsCatalog)
    const label = t("automations.editor.moreActionsFor", {name})
    return (
        <DropdownMenu open={open}>
            <SimpleTooltip title={t("ui.controls.moreActions")}>
                <DropdownMenuTrigger asChild>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={label}
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-foreground"
                    >
                        <DotsThreeVertical aria-hidden />
                    </Button>
                </DropdownMenuTrigger>
            </SimpleTooltip>
            {/* Under the button, its right edge on the row's: the menu stays inside the panel. */}
            <DropdownMenuContent align="end" container={container} className="w-popover-sm">
                {menu}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
