import {CollapseCaret} from "@agenta/ui/ui"

/**
 * The button on a newest row that shows or hides the older items of its group. A row with no
 * older item keeps the same space, so the names line up.
 */
export const ExpandToggle = ({
    count,
    expanded,
    label,
    onToggle,
}: {
    /** How many older items the row holds. */
    count: number
    expanded: boolean
    /** Names the group for a screen reader: "Show older revisions of default". */
    label: string
    onToggle: () => void
}) =>
    count > 0 ? (
        <button
            type="button"
            aria-expanded={expanded}
            aria-label={label}
            onClick={(event) => {
                event.stopPropagation()
                onToggle()
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="-m-1 inline-flex shrink-0 cursor-pointer items-center border-0 bg-transparent p-1 text-muted-foreground hover:text-foreground"
        >
            <CollapseCaret open={expanded} />
        </button>
    ) : (
        <span aria-hidden className="inline-block w-3 shrink-0" />
    )
