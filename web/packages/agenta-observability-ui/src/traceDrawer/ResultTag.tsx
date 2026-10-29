import {memo, type CSSProperties, type ReactNode} from "react"

import {Pill} from "../primitives/Pill"

/**
 * The trace-drawer tag: a label half and a value half sharing one pill, or a single centred
 * value when `value2` is omitted.
 *
 * antd `Tag` before; the chrome is drawn here so `/m` can render it. antd's own was only a
 * border, radius and fill, and `bordered={false}` is antd's "filled" variant — every call site
 * passes that plus its own background, so the bordered branch is the odd one out.
 *
 * `popoverContent` opens on click, as antd's `trigger="click"` did — the token breakdown behind
 * the "Tokens & Cost" pill is the one caller.
 *
 * Shares its structure with `LabelValuePill` via `Pill`; the two differ only in measurements.
 */
export interface ResultTagProps {
    value1: ReactNode
    value2?: ReactNode
    className?: string
    style?: CSSProperties
    /** antd parity: `false` renders the filled variant (no border). @default true */
    bordered?: boolean
    onClick?: () => void
    popoverContent?: ReactNode
}

/** Kept verbatim from the app: call sites pass this same string for their own inner divs. */
export const resultTagClass =
    "flex items-center w-fit p-0 cursor-pointer [&>span.value1]:bg-colorFillQuaternary [&>span.value1]:flex-1 [&>span.value1]:px-2 [&>span.value1]:border-r [&>span.value1]:border-colorBorder [&>span.value2]:bg-colorBgContainer [&>span.value2]:pl-1 [&>span.value2]:pr-2 [&>span.value2]:rounded-[inherit] [&>div.singleValue]:px-2 [&>div.singleValue]:flex [&>div.singleValue]:items-center [&>div.singleValue]:gap-2"

// antd Tag's box: 12px text, 4px radius, and a hairline border painted even in the filled
// variant (as transparent) so both variants share a height.
const BOX =
    "box-border inline-flex items-center overflow-hidden text-xs leading-5 border border-solid rounded-control " +
    // The wrap rules the app version put directly on the value/single halves.
    "[&>span.value2]:break-words [&>span.value2]:overflow-hidden [&>span.value2]:whitespace-break-spaces " +
    "[&>div.singleValue]:break-words [&>div.singleValue]:overflow-hidden [&>div.singleValue]:whitespace-break-spaces"

const ResultTag = memo(({className, bordered, ...rest}: ResultTagProps) => (
    <Pill
        {...rest}
        rootClassName={`${BOX} ${
            bordered === false
                ? "border-transparent bg-colorFillTertiary"
                : "border-colorBorder bg-colorFillQuaternary"
        } ${resultTagClass}`}
        className={className}
    />
))

ResultTag.displayName = "ResultTag"

export default ResultTag
