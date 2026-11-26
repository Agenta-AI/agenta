/** The event's fields as small tags under the instruction; a click adds the field as a pill. */
import type {EventField} from "@agenta/entities/gatewayTrigger"
import {Tooltip, TooltipContent, TooltipProvider, TooltipTrigger} from "@agenta/ui/ui"
import {Check, Plus} from "@phosphor-icons/react"

// A tag looks like the pill it adds. The provider's description shows on hover and on keyboard
// focus; touch screens have no hover, so there a tap only adds the pill.
export function EventFieldTags({
    fields,
    used,
    onInsert,
}: {
    fields: EventField[]
    /** Selectors the instruction already has; their tags show a check. */
    used: ReadonlySet<string>
    onInsert: (field: EventField) => void
}) {
    if (!fields.length) return null
    return (
        <TooltipProvider delayDuration={300}>
            <div className="flex flex-wrap gap-1">
                {fields.map((field) => {
                    const isUsed = used.has(field.selector)
                    const tag = (
                        <button
                            key={field.key}
                            type="button"
                            onClick={() => onInsert(field)}
                            aria-pressed={isUsed}
                            aria-label={
                                field.description
                                    ? `${field.label}: ${field.description}`
                                    : field.label
                            }
                            className={`inline-flex cursor-pointer items-center gap-1 rounded-md border border-solid border-border bg-muted px-1.5 py-0.5 font-[inherit] text-xs font-medium text-foreground transition-colors hover:border-primary ${
                                isUsed ? "opacity-60" : ""
                            }`}
                        >
                            {isUsed ? (
                                <Check aria-hidden className="size-3 text-primary" weight="bold" />
                            ) : (
                                <Plus aria-hidden className="size-3 text-muted-foreground" />
                            )}
                            {field.label}
                        </button>
                    )
                    if (!field.description) return tag
                    return (
                        <Tooltip key={field.key}>
                            <TooltipTrigger asChild>{tag}</TooltipTrigger>
                            <TooltipContent side="bottom" className="max-w-[260px]">
                                {field.description}
                            </TooltipContent>
                        </Tooltip>
                    )
                })}
            </div>
        </TooltipProvider>
    )
}
