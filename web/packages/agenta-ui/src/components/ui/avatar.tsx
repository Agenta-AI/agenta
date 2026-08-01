import * as React from "react"

import * as AvatarPrimitive from "@radix-ui/react-avatar"
import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Avatar — a Radix primitive in @agenta/ui, following shadcn's source conventions (no
 * `forwardRef`, `data-slot` on every part). Re-skins antd `Avatar` with NO visual change.
 *
 * antd → @agenta/ui: `src`→`AvatarImage`, `children`/`icon`→`AvatarFallback`, `size`
 * (small/default/large + number)→`size`, `shape` (circle/square)→`shape`. The three Radix
 * parts (`Avatar`, `AvatarImage`, `AvatarFallback`) compose freely; `AvatarBox` is the
 * antd-shaped convenience wrapper (and the shape `InitialsAvatar` folds into).
 *
 * Measured antd parity (light + dark, app-OVERRIDDEN seed tokens — NOT stock 24/32/40):
 *  - box: small 24 / default 28 / large 34  → `size-control-sm/-/-lg`, plus antd's
 *    `border: 1px solid transparent` (avatar/style/index.js L61) — it insets the image by
 *    1px and shrinks the content box the initials centre in.
 *  - radius: circle 50% (`rounded-control-round`); square SCALES with size —
 *    small 6 / default 8 / large 10 (`rounded-control-sm/-/-lg`), numeric→8.
 *  - fill: antd default avatar bg = `colorTextPlaceholder` (#bdc7d1 light /
 *    rgba(255,255,255,.38) dark — matches both). text = `colorTextLightSolid` (white both).
 *  - font: antd base per size then a scale-to-fit; string 12/18/20 (numeric→18), icon
 *    12/16/20 (numeric→size/2). String children get antd's ResizeObserver shrink
 *    (`scale = min(1,(width-gap*2)/textWidth)`, gap 4) so long/large initials fit.
 * Arbitrary `text-[Npx]` is used for the font ramp (no control-scale key maps to
 * avatar's 18/20px glyph sizes); `box-border` is required (preflight OFF). `font-portal`
 * keeps initials in Inter even if the avatar is portaled (menus/tooltips).
 */

export type AvatarSize = "small" | "default" | "large"
export type AvatarShape = "circle" | "square"

const avatarVariants = cva(
    // `border-solid` is load-bearing (preflight OFF): without it the width computes to 0 and
    // the 1px inset antd gets from `border: 1px solid transparent` disappears.
    "relative box-border inline-flex shrink-0 select-none items-center justify-center overflow-hidden border border-solid border-transparent bg-colorTextPlaceholder text-colorTextLightSolid font-portal leading-[1.6666666666666667]",
    {
        variants: {
            // Dims + default string font per size (AvatarBox overrides font inline for
            // icon/numeric precision). Arbitrary px: no control-scale font key fits.
            size: {
                small: "size-control-sm text-[12px]",
                default: "size-control text-[18px]",
                large: "size-control-lg text-[20px]",
            },
            shape: {
                circle: "rounded-control-round",
                // Default square radius (8px) — also the numeric-size fallback.
                square: "rounded-control",
            },
        },
        compoundVariants: [
            {shape: "square", size: "small", className: "rounded-control-sm"},
            {shape: "square", size: "large", className: "rounded-control-lg"},
        ],
        defaultVariants: {size: "default", shape: "circle"},
    },
)

// ============================== Radix primitives ==============================
export interface AvatarProps
    extends
        React.ComponentProps<typeof AvatarPrimitive.Root>,
        VariantProps<typeof avatarVariants> {}

function Avatar({className, size, shape, ...props}: AvatarProps) {
    return (
        <AvatarPrimitive.Root
            data-slot="avatar"
            className={cn(avatarVariants({size, shape}), className)}
            {...props}
        />
    )
}

function AvatarImage({className, ...props}: React.ComponentProps<typeof AvatarPrimitive.Image>) {
    return (
        <AvatarPrimitive.Image
            data-slot="avatar-image"
            className={cn("aspect-square size-full object-cover", className)}
            {...props}
        />
    )
}

function AvatarFallback({
    className,
    ...props
}: React.ComponentProps<typeof AvatarPrimitive.Fallback>) {
    return (
        <AvatarPrimitive.Fallback
            data-slot="avatar-fallback"
            // No line-height of its own: the string's line box must match antd's root.
            className={cn("inline-flex size-full items-center justify-center", className)}
            {...props}
        />
    )
}

// ============================== Scaled text (antd string fit) ==============================
/**
 * antd shrinks string children so they fit: `scale = min(1, (nodeWidth - gap*2)/textWidth)`.
 * `offsetWidth` is transform-independent, so one pass settles; a ResizeObserver re-fits on
 * box changes. Centered via the flex fallback, so only `scale` (origin center) is needed.
 */
function AvatarText({children, gap = 4}: {children: React.ReactNode; gap?: number}) {
    const textRef = React.useRef<HTMLSpanElement>(null)
    const [scale, setScale] = React.useState(1)

    React.useLayoutEffect(() => {
        const el = textRef.current
        // The ROOT, not the fallback: antd divides by the avatar's border-box width.
        const node = el?.closest<HTMLElement>("[data-slot=avatar]")
        if (!el || !node) return
        const compute = () => {
            const textW = el.offsetWidth
            const nodeW = node.offsetWidth
            if (textW && nodeW && gap * 2 < nodeW) {
                setScale(nodeW - gap * 2 < textW ? (nodeW - gap * 2) / textW : 1)
            }
        }
        compute()
        // Observe the text too: a late web-font swap changes the glyph width but not the box,
        // so re-fit then (the scale transform never changes content-box → no observer loop).
        const ro = new ResizeObserver(compute)
        ro.observe(node)
        ro.observe(el)
        document.fonts?.ready.then(compute).catch(() => {})
        return () => ro.disconnect()
    }, [children, gap])

    return (
        <span
            ref={textRef}
            data-slot="avatar-text"
            className="inline-block origin-center whitespace-nowrap"
            style={{transform: `scale(${scale})`}}
        >
            {children}
        </span>
    )
}

// ============================== Convenience wrapper ==============================
export interface AvatarBoxProps extends Omit<AvatarProps, "size" | "children"> {
    /** antd `src`. When set, the image renders with the fallback behind it. */
    src?: string
    /** Image `alt` (also the accessible name for an icon-only avatar). */
    alt?: string
    /** antd `size`: a preset OR a raw pixel number (e.g. `18`). */
    size?: AvatarSize | number
    /** antd `icon`: fallback content when there is no `src`/`children`. */
    icon?: React.ReactNode
    /** antd children: initials / custom content (takes precedence over `icon`). */
    children?: React.ReactNode
    /** ms before the fallback shows while the image loads (Radix `Avatar.Fallback delayMs`). */
    fallbackDelayMs?: number
    /** antd `gap`: min px between the initials and the avatar edge (drives the fit scale). */
    gap?: number
}

// antd base font-size per preset, split by content (icon default 16 ≠ string default 18).
const STRING_FONT: Record<AvatarSize, number> = {small: 12, default: 18, large: 20}
const ICON_FONT: Record<AvatarSize, number> = {small: 12, default: 16, large: 20}

/**
 * antd-shaped convenience Avatar: one tag with `src`/`alt`/`icon`/children + `size`/`shape`.
 * Mirrors antd's single-element API so call-sites (and `InitialsAvatar`) map 1:1.
 */
function AvatarBox({
    src,
    alt,
    size = "default",
    shape = "circle",
    icon,
    children,
    className,
    style,
    fallbackDelayMs,
    gap = 4,
    ...props
}: AvatarBoxProps) {
    const isNumeric = typeof size === "number"
    const hasText = children != null
    const isIcon = !hasText && icon != null

    // antd font-size model: numeric → icon:size/2, string:18; preset → per-content table.
    const fontSize = isNumeric
        ? isIcon
            ? (size as number) / 2
            : 18
        : (isIcon ? ICON_FONT : STRING_FONT)[size as AvatarSize]

    const mergedStyle: React.CSSProperties = {
        fontSize,
        ...(isNumeric ? {width: size as number, height: size as number} : null),
        ...style,
    }

    const fallback = hasText ? (
        typeof children === "string" || typeof children === "number" ? (
            <AvatarText gap={gap}>{children}</AvatarText>
        ) : (
            children
        )
    ) : (
        icon
    )

    return (
        <Avatar
            size={isNumeric ? undefined : (size as AvatarSize)}
            shape={shape}
            // antd clears the root fill for image avatars (the image covers it); the fill
            // moves to the fallback so it still shows if the image fails to load.
            className={cn(src && "bg-transparent", className)}
            style={mergedStyle}
            // An icon-only avatar is an image; role=img makes the aria-label a permitted,
            // accessible name (aria-label on a bare <span> is prohibited).
            role={!src && alt ? "img" : undefined}
            aria-label={!src && alt ? alt : undefined}
            {...props}
        >
            {src ? <AvatarImage src={src} alt={alt} /> : null}
            <AvatarFallback
                className={cn(src && "bg-colorTextPlaceholder")}
                delayMs={src ? fallbackDelayMs : 0}
            >
                {fallback}
            </AvatarFallback>
        </Avatar>
    )
}

export {Avatar, AvatarImage, AvatarFallback, AvatarBox, avatarVariants}
