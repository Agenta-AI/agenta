import {cn} from "@agenta/ui/styles"
import {Check, Compass} from "@phosphor-icons/react"

/** The skill tile; on hover, or while rows are selected, it is the row's checkbox. */
export const SkillAvatarCheck = ({
    title,
    checked,
    selecting,
    onToggle,
    size = 32,
}: {
    title: string
    checked: boolean
    /** Any row is selected: every tile shows as a checkbox. */
    selecting: boolean
    onToggle: () => void
    size?: 32 | 40
}) => (
    <label
        className={cn(
            "group/check relative flex shrink-0 cursor-pointer",
            size === 40 ? "size-10 rounded-xl" : "size-8 rounded-[9px]",
        )}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
    >
        <input
            type="checkbox"
            className="peer absolute inset-0 z-[1] m-0 size-full cursor-pointer opacity-0"
            checked={checked}
            onChange={onToggle}
            aria-label={`Select ${title}`}
        />
        <span
            aria-hidden
            className={cn(
                "relative box-border flex size-full items-center justify-center overflow-hidden rounded-[inherit] border border-solid transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground",
                checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : cn(
                          "border-border bg-muted text-muted-foreground group-hover/check:border-ring group-hover/check:text-foreground",
                          selecting && "border-dashed border-ring",
                      ),
            )}
        >
            <Compass
                size={size === 40 ? 18 : 16}
                className={cn(
                    "absolute transition-[transform,opacity] duration-200",
                    checked || selecting
                        ? "scale-50 opacity-0"
                        : "group-hover/check:-translate-y-[70%] group-hover/check:opacity-0",
                )}
            />
            <Check
                size={size === 40 ? 18 : 15}
                weight="bold"
                className={cn(
                    "absolute transition-[transform,opacity] duration-200",
                    checked
                        ? "opacity-100"
                        : selecting
                          ? "opacity-40"
                          : "translate-y-[70%] opacity-0 group-hover/check:translate-y-0 group-hover/check:opacity-50",
                )}
            />
        </span>
    </label>
)
