/** The info marker: an explanation behind the kit's field help, next to whatever it explains. */
import type {ReactNode} from "react"

import {useT} from "@agenta/i18n"
import drawerSharedCatalog from "@agenta/i18n/catalogs/entityUi.drawerShared"
import {FieldHelp} from "@agenta/ui/ui"

export function HelpTip({
    label,
    children,
    side = "right",
}: {
    /** Names the control this explains; also the help's heading. */
    label: string
    children: ReactNode
    side?: "top" | "right" | "bottom" | "left"
}) {
    const t = useT(drawerSharedCatalog)
    return (
        <FieldHelp label={t("entityUi.drawerShared.about", {label})} heading={label} side={side}>
            {children}
        </FieldHelp>
    )
}
