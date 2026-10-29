/** The event's fields as cards under the instruction; a click adds the field as a pill. */
import type {EventFieldCard, EventFieldGroup} from "@agenta/entities/gatewayTrigger"
import {Check} from "@phosphor-icons/react"

export function EventFieldCards({
    groups,
    used,
    onInsert,
    disabled,
}: {
    groups: EventFieldGroup[]
    /** Selectors the instruction already has; their cards show a check. */
    used: ReadonlySet<string>
    onInsert: (card: EventFieldCard) => void
    disabled?: boolean
}) {
    if (!groups.length) return null
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3">
                <span className="text-[13px] font-medium text-foreground">
                    Add details from the event
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">Click to add</span>
            </div>
            {groups.map((group) => (
                <div key={group.key} className="flex flex-col gap-1.5">
                    {group.label ? (
                        <span className="text-xs font-medium text-muted-foreground">
                            {group.label}
                        </span>
                    ) : null}
                    <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
                        {group.cards.map((card) => {
                            const isUsed = used.has(card.selector)
                            return (
                                <button
                                    key={card.key}
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onInsert(card)}
                                    aria-pressed={isUsed}
                                    className={`box-border flex min-w-0 cursor-pointer flex-col items-start gap-0.5 rounded-lg border border-solid border-border bg-background px-3 py-2 text-left font-[inherit] transition-colors hover:border-primary disabled:cursor-not-allowed ${
                                        isUsed ? "opacity-60" : ""
                                    }`}
                                >
                                    <span className="flex w-full min-w-0 items-center gap-1.5 text-[13px] font-semibold text-foreground">
                                        <span className="min-w-0 flex-1 truncate">
                                            {card.label}
                                        </span>
                                        {isUsed ? (
                                            <Check
                                                aria-hidden
                                                className="size-3.5 shrink-0 text-primary"
                                                weight="bold"
                                            />
                                        ) : null}
                                    </span>
                                    {card.description ? (
                                        <span className="line-clamp-2 text-xs text-muted-foreground">
                                            {card.description}
                                        </span>
                                    ) : null}
                                </button>
                            )
                        })}
                    </div>
                </div>
            ))}
        </div>
    )
}
