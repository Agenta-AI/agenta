import {cn} from "@agenta/ui/styles"
import {Check, Compass} from "@phosphor-icons/react"

const LAYER =
    "absolute inset-0 flex items-center justify-center " +
    "[transition:translate_240ms_cubic-bezier(0.2,0.8,0.2,1),scale_240ms_cubic-bezier(0.2,0.8,0.2,1),opacity_180ms] " +
    "motion-reduce:transition-none"

/** The skill tile; on hover it turns into the row's checkbox. */
export const SkillAvatarCheck = ({
    title,
    checked,
    selecting,
    onToggle,
    size = 32,
}: {
    title: string
    checked: boolean
    /** Any row is selected: unselected tiles get a dashed edge. */
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
                "relative box-border size-full overflow-hidden rounded-[inherit] border border-solid transition-colors duration-200 motion-reduce:transition-none",
                "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-foreground",
                checked
                    ? "border-primary bg-primary text-primary-foreground"
                    : cn(
                          "border-border bg-muted text-muted-foreground group-hover/check:border-ring group-hover/check:text-foreground",
                          selecting && "border-dashed border-ring",
                      ),
            )}
        >
            <span
                className={cn(
                    LAYER,
                    checked
                        ? "scale-[0.4] opacity-0"
                        : "group-hover/check:-translate-y-[70%] group-hover/check:opacity-0",
                )}
            >
                <Compass size={size === 40 ? 18 : 16} />
            </span>
            <span
                className={cn(
                    LAYER,
                    checked
                        ? "animate-skill-pop opacity-100"
                        : "translate-y-[70%] opacity-0 group-hover/check:translate-y-0 group-hover/check:opacity-55",
                )}
            >
                <Check size={size === 40 ? 18 : 15} weight="bold" />
            </span>
        </span>
    </label>
)
