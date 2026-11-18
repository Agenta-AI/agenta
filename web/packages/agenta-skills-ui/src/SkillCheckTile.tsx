import {cn} from "@agenta/ui/styles"
import {Check, Compass} from "@phosphor-icons/react"

const LAYER =
    "absolute inset-0 flex items-center justify-center " +
    "[transition:translate_240ms_cubic-bezier(0.2,0.8,0.2,1),scale_240ms_cubic-bezier(0.2,0.8,0.2,1),opacity_180ms] " +
    "motion-reduce:transition-none"

/**
 * The skill tile that turns into a check. Its hover state follows the nearest `group/check`,
 * so the host decides what counts as hovering: the tile itself or the whole row.
 */
export const SkillCheckTile = ({
    checked,
    size = 32,
}: {
    checked: boolean
    size?: 28 | 32 | 40
}) => (
    <span
        aria-hidden
        className={cn(
            "relative box-border block shrink-0 overflow-hidden transition-[background-color,color,box-shadow] duration-200 motion-reduce:transition-none",
            size === 40 ? "size-10 rounded-[9px]" : size === 32 ? "size-8 rounded-[7px]" : "size-7 rounded-[6px]",
            checked
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground group-hover/check:bg-background group-hover/check:text-foreground group-hover/check:shadow-sm",
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
            <Compass size={size === 40 ? 18 : size === 32 ? 16 : 14} />
        </span>
        <span
            className={cn(
                LAYER,
                checked
                    ? "animate-skill-pop opacity-100"
                    : "translate-y-[70%] opacity-0 group-hover/check:translate-y-0 group-hover/check:opacity-55",
            )}
        >
            <Check size={size === 40 ? 18 : size === 32 ? 15 : 13} weight="bold" />
        </span>
    </span>
)
