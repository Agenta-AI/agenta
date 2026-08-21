import {memo, type CSSProperties, type ReactNode} from "react"

import {Popover, PopoverContent, PopoverTrigger} from "@agenta/ui/ui"
import clsx from "clsx"

/**
 * The split pill both observability tags are made of: a label half and a value half sharing one
 * box, or a single centred value when there is no second half.
 *
 * `ResultTag` (trace drawer) and `LabelValuePill` (evaluator metric cells) were two components
 * drawing the same thing with different measurements, so a fix to one silently missed the other.
 * The structure lives here once; each preset below supplies its own COMPLETE class set rather
 * than layering onto a shared base, because these are plain `clsx` joins — a shared base would
 * leave `rounded-sm` and `rounded-control` both present and let CSS source order decide.
 *
 * The halves are addressed as `span.value1` / `span.value2` / `div.singleValue` and carry NO
 * styling of their own, so a preset owns every measurement through arbitrary variants. Baking
 * even a wrap rule in here would silently apply it to the other preset.
 */
export interface PillProps {
    value1: ReactNode
    value2?: ReactNode
    /** Complete class set for the box — a preset, not an addition to a base. */
    rootClassName: string
    className?: string
    valueClassName?: string
    style?: CSSProperties
    onClick?: () => void
    /** Rendered in a popover opened by clicking the pill. */
    popoverContent?: ReactNode
}

export const Pill = memo(
    ({
        value1,
        value2,
        rootClassName,
        className,
        valueClassName,
        style,
        onClick,
        popoverContent,
    }: PillProps) => {
        const content =
            value2 !== undefined ? (
                <>
                    <span className="value1">{value1}</span>
                    <span className={clsx("value2", valueClassName)}>{value2}</span>
                </>
            ) : (
                <div className="singleValue">{value1}</div>
            )

        const pill = (
            <span className={clsx(rootClassName, className)} style={style} onClick={onClick}>
                {content}
            </span>
        )

        if (!popoverContent) return pill

        return (
            <Popover>
                {/* Span wrapper: the trigger must not collapse onto the pill's own element. */}
                <PopoverTrigger asChild>
                    <span className="inline-flex">{pill}</span>
                </PopoverTrigger>
                {/* antd anchored this below and sized it 240px wide. */}
                <PopoverContent side="bottom" className="w-60">
                    {popoverContent}
                </PopoverContent>
            </Popover>
        )
    },
)

Pill.displayName = "Pill"

export default Pill
