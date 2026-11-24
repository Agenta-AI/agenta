/**
 * The parts both automation rows share (F05 f1, M10): the card frame, the colored tile with a
 * white glyph, the name and its line, and the status dot at the right.
 */
import {type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {cn, Tooltip, TooltipContent, TooltipTrigger} from "@agenta/ui/ui"

/** The row frame on a desktop: a white card with a border. */
export const ROW_CLASS =
    "group flex items-center gap-2.5 rounded-lg border border-solid border-border-muted bg-background py-2.5 pl-3 pr-2 transition-colors"

/** The name on a desktop. */
export const NAME_CLASS = "truncate text-label"

/** The line under the name on a desktop. */
export const LINE_CLASS = "truncate text-meta text-muted-foreground"

/**
 * The 24 px Mark before the name (CONS-01): neutral, with the trigger glyph; an app trigger
 * shows the app's logo when the catalog has one.
 */
export function RowTile({children, className}: {children: ReactNode; className?: string}) {
    return (
        <span
            aria-hidden
            className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-md bg-secondary text-muted-foreground [&_svg]:size-3.5",
                className,
            )}
        >
            {children}
        </span>
    )
}

/** On or paused, as an 8 px dot at the right of the row, named by its tooltip. */
export function RowStatusDot({active}: {active: boolean}) {
    const t = useT(triggersCatalog)
    const label = active ? t("entityUi.triggers.active") : t("entityUi.triggers.paused")
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    role="img"
                    aria-label={label}
                    className={cn(
                        "mx-1 size-2 shrink-0 rounded-round",
                        active
                            ? "bg-success"
                            : "bg-border-strong",
                    )}
                />
            </TooltipTrigger>
            <TooltipContent>{label}</TooltipContent>
        </Tooltip>
    )
}
