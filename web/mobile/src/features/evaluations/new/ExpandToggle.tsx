import {CaretDownIcon, CaretRightIcon} from "@phosphor-icons/react"

/**
 * The button on a newest row that shows or hides the older items of its group. A row with no
 * older item keeps the same space while another row can expand, so the names line up.
 */
export const ExpandToggle = ({
    count,
    expanded,
    label,
    reserve = true,
    onToggle,
}: {
    /** How many older items the row holds. */
    count: number
    expanded: boolean
    /** Names the group for a screen reader: "Show older revisions of default". */
    label: string
    /** Keep the button's space on a row with nothing to expand; off when no row can expand. */
    reserve?: boolean
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
            {expanded ? <CaretDownIcon size={12} /> : <CaretRightIcon size={12} />}
        </button>
    ) : reserve ? (
        <span aria-hidden className="inline-block w-3 shrink-0" />
    ) : null
