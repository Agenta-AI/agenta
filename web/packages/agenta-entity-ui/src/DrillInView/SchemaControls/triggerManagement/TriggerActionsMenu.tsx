/** The trigger rows' shared "⋯" actions menu (identical in both row shapes). */
import {type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {Button, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger} from "@agenta/ui/ui"
import {DotsThree, DotsThreeVertical} from "@phosphor-icons/react"

export function TriggerActionsMenu({
    menu,
    open,
    container,
    phone,
}: {
    /** The composed menu body (`DropdownMenuItem` / `DropdownMenuSeparator` JSX). */
    menu: ReactNode
    /** Force open — controlled usage and forced-open parity stories. */
    open?: boolean
    /** Portal target; defaults to document.body (pass an element to render inline). */
    container?: HTMLElement | null
    /** Phone: "⋯" lies flat and is 44 px; each entry is at least 44 px high. */
    phone?: boolean
}) {
    const t = useT(triggersCatalog)
    return (
        <DropdownMenu open={open}>
            <DropdownMenuTrigger asChild>
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("entityUi.triggers.openTriggerActions")}
                    onClick={(e) => e.stopPropagation()}
                    className={phone ? "size-11" : undefined}
                >
                    {phone ? (
                        <DotsThree size={20} weight="bold" />
                    ) : (
                        <DotsThreeVertical size={16} weight="bold" />
                    )}
                </Button>
            </DropdownMenuTrigger>
            {/* w-[180px] = the antd Dropdown's `styles={{root: {width: 180}}}`. */}
            <DropdownMenuContent
                align={phone ? "end" : "start"}
                container={container}
                className={
                    phone
                        ? "w-[220px] [&_[role=menuitem]]:min-h-11 [&_[role=menuitem]]:text-[15px]"
                        : "w-[180px]"
                }
            >
                {menu}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
