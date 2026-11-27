/**
 * The parts both automation rows share (F05 f1, M10): the card frame, the colored tile with a
 * white glyph, the name and its line, and the status dot at the right.
 */
import {type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import triggersCatalog from "@agenta/i18n/catalogs/entityUi.triggers"
import {cn, SkeletonBlock, Tooltip, TooltipContent, TooltipTrigger} from "@agenta/ui/ui"

/** The row frame on a desktop: a white card with a border. */
export const ROW_CLASS =
    "group flex items-center gap-2.5 rounded-lg border border-solid border-border-muted bg-background py-2.5 pl-3 pr-2 transition-colors " +
    // In the panel's flat list: a plain row with the hover fill, its Mark on the heading's line.
    "in-data-flat-rows:rounded-md in-data-flat-rows:border-transparent in-data-flat-rows:bg-transparent in-data-flat-rows:py-1.5 in-data-flat-rows:pl-2 in-data-flat-rows:pr-1 in-data-flat-rows:hover:border-transparent in-data-flat-rows:hover:bg-accent"

/** The gap from the Mark to the name: 12 px beside the flat list's 32 px Mark (`mark-lg`). */
export const ROW_LEAD_GAP = "gap-2.5 in-data-flat-rows:gap-3"

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
                // A two-line row's 32 px Mark with a 16 px glyph in the panel's flat list.
                "in-data-flat-rows:size-8 in-data-flat-rows:[&_svg]:size-4",
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
        <span className="flex shrink-0 items-center">
            <Tooltip>
                <TooltipTrigger asChild>
                    <span
                        role="img"
                        aria-label={label}
                        className={cn(
                            "mx-1 size-2 shrink-0 rounded-round",
                            active ? "bg-success" : "bg-border-strong",
                        )}
                    />
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
            </Tooltip>
            {/* In the panel's flat list the state is also a word (COLOR-03). */}
            <span
                aria-hidden
                className="hidden pr-1 text-meta text-muted-foreground in-data-flat-rows:inline"
            >
                {label}
            </span>
        </span>
    )
}

/** The frame of a flat row with no content of its own: the loading and the empty row. */
const FLAT_ROW =
    "flex w-full items-center gap-2 rounded-md border border-solid border-transparent bg-transparent py-1.5 pl-2 pr-1"

/** A loading row with the loaded row's shape: the Mark, the name, its line, the state, the menu (STATE-02). */
export function RowSkeleton() {
    return (
        <div aria-hidden className={cn(FLAT_ROW, "gap-2.5")}>
            <div className={cn("flex min-w-0 flex-1 items-center", ROW_LEAD_GAP)}>
                <SkeletonBlock active className="size-8 shrink-0 rounded-md" />
                <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex h-4.5 items-center">
                        <SkeletonBlock active className="h-3.5 w-36 max-w-full" />
                    </div>
                    <div className="flex h-4 items-center">
                        <SkeletonBlock active className="h-3 w-48 max-w-full" />
                    </div>
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                <span className="flex items-center">
                    <SkeletonBlock active className="mx-1 size-2 shrink-0 rounded-round" />
                    <span className="pr-1">
                        <SkeletonBlock active className="h-3 w-9" />
                    </span>
                </span>
                <span className="flex size-6 items-center justify-center">
                    <SkeletonBlock active className="size-3.5" />
                </span>
            </div>
        </div>
    )
}

/**
 * The empty row of the list (STATE-01): what is missing, what it is for, and the first action,
 * which is the row itself. It has a row's shape, so the first real row moves nothing. A person
 * who cannot edit gets the same row with no action.
 */
export function EmptyListRow({
    icon,
    title,
    line,
    onAdd,
}: {
    icon: ReactNode
    title: string
    line: string
    onAdd?: () => void
}) {
    const body = (
        <>
            {/* An open slot: the glyph in a dashed Mark with no fill. */}
            <RowTile className="border border-dashed border-border bg-transparent">{icon}</RowTile>
            <div className="min-w-0 flex-1">
                <div className={cn(NAME_CLASS, "text-muted-foreground")}>{title}</div>
                <div className={LINE_CLASS}>{line}</div>
            </div>
        </>
    )
    return onAdd ? (
        <button
            type="button"
            onClick={onAdd}
            className={cn(
                FLAT_ROW,
                "focus-ring cursor-pointer text-left font-[inherit] transition-colors hover:bg-accent",
            )}
        >
            {body}
        </button>
    ) : (
        <div className={FLAT_ROW}>{body}</div>
    )
}
