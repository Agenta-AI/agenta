import {useState} from "react"

import {SimpleTooltip} from "@agenta/ui/ui"
import {CaretDown, CaretRight, Info} from "@phosphor-icons/react"

/**
 * One collapsible group of the embed settings. A closed group shows its current value, and its
 * error if it has one. Its fields stay mounted while closed, so the preview keeps its state.
 */
export const EmbedSection = ({
    title,
    info,
    summary,
    error,
    defaultOpen = false,
    testId,
    children,
}: {
    title: string
    /** A tooltip next to the title. */
    info?: string
    /** The current value, shown on the right while the group is closed. */
    summary?: string
    /** A refused value inside the group, repeated under the title while the group is closed. */
    error?: string | null
    defaultOpen?: boolean
    testId: string
    children: React.ReactNode
}) => {
    const [open, setOpen] = useState(defaultOpen)
    return (
        <section
            className="flex flex-col gap-2.5 border-0 border-t border-solid border-border pt-3.5"
            data-testid={testId}
        >
            {/* The whole title row toggles; the button inside gives keyboard and screen reader access. */}
            <div
                className="flex cursor-pointer items-center gap-1.5"
                onClick={() => setOpen((value) => !value)}
            >
                <button
                    type="button"
                    aria-expanded={open}
                    className="flex min-w-0 cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-[13px] font-semibold text-foreground"
                    data-testid={`${testId}-toggle`}
                >
                    {open ? <CaretDown size={12} /> : <CaretRight size={12} />}
                    {title}
                </button>
                {info ? (
                    <SimpleTooltip title={info}>
                        <button
                            type="button"
                            aria-label={`About ${title.toLowerCase()}`}
                            onClick={(event) => event.stopPropagation()}
                            className="inline-flex border-0 bg-transparent p-0 text-muted-foreground"
                        >
                            <Info size={14} />
                        </button>
                    </SimpleTooltip>
                ) : null}
                {!open && summary ? (
                    <span
                        className="ml-auto truncate pl-2 text-[12.5px] text-muted-foreground"
                        data-testid={`${testId}-summary`}
                    >
                        {summary}
                    </span>
                ) : null}
            </div>
            {!open && error ? (
                <span role="alert" className="text-[12.5px] text-destructive">
                    {error}
                </span>
            ) : null}
            <div className={open ? "flex flex-col gap-2.5" : "hidden"}>{children}</div>
        </section>
    )
}
