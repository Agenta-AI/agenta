import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Skeleton — a presentational @agenta/ui port of antd `Skeleton` (plain div/ul/li + cva, no Radix).
 * Reproduces antd's base block, avatar, and the default avatar+title+paragraph composite.
 *
 * Block colour = antd `gradientFromColor` = `colorFillContent` = `colorFillSecondary`
 * (`bg-fill-secondary`). `active` shimmer = antd's swept gradient
 * (`linear-gradient(90deg, colorFillSecondary 25%, colorFill 37%, colorFillSecondary 63%)`
 * over `400% 100%`) animated by the shared `animate-skeleton` keyframe (already in
 * tailwind.config). Geometry matches the app-themed antd exactly: title/rows are
 * `controlHeight/2 = 14px` (`h-3.5`), avatars are controlHeightSM/controlHeight/controlHeightLG
 * = 24/28/34px, radius 6px from the control scale. The title is an `<h3>` and the paragraph a
 * `<ul>` so both keep antd's UA margin-block (14.04 / 12px) that antd's layout relies on.
 * Content-driven widths (38/50/61%) are inline styles, as antd does. `box-border` is required
 * (preflight is OFF app-wide). The placeholder is decorative, so every root carries `aria-hidden`.
 *
 * antd → @agenta/ui mapping: active/loading/avatar/title/paragraph/round map 1:1. The rarer
 * element pieces (`Skeleton.Button`/`Input`/`Image`/`Node`) are deferred — see Skeleton.md.
 */
const skeletonBlockVariants = cva("box-border block", {
    variants: {
        // antd `active`: gradient band swept across the block; else a flat fill.
        active: {
            true: "animate-skeleton bg-[length:400%_100%] bg-[linear-gradient(90deg,var(--ag-colorFillSecondary)_25%,var(--ag-colorFill)_37%,var(--ag-colorFillSecondary)_63%)]",
            false: "bg-fill-secondary",
        },
        // block = borderRadiusSM 6px; round = borderRadius 8px; circle = 50%; square = 0.
        shape: {
            block: "rounded-control-sm",
            round: "rounded-control",
            circle: "rounded-control-round",
            square: "rounded-none",
        },
    },
    defaultVariants: {active: false, shape: "block"},
})

export type SkeletonAvatarSize = "small" | "default" | "large"
export type SkeletonAvatarShape = "circle" | "square"

// antd avatar = controlHeightSM/controlHeight/controlHeightLG. The app OVERRIDES antd's seed
// tokens, so these are 24/28/34 (not the stock 24/32/40) — measured from the rendered antd
// `.ant-skeleton-avatar`. `size-[34px]` has no scale key (34 is not a 4px step); see guide.
const AVATAR_SIZE: Record<SkeletonAvatarSize, string> = {
    small: "size-6",
    default: "size-7",
    large: "size-[34px]",
}

// ============================== Base block ==============================
export interface SkeletonBlockProps
    extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof skeletonBlockVariants> {
    ref?: React.Ref<HTMLDivElement>
}

/** Generic skeleton block (defaults to a full-width 16px bar); size via className. */
export function SkeletonBlock({className, active, shape, ...props}: SkeletonBlockProps) {
    return (
        <div
            data-slot="skeleton-block"
            aria-hidden
            className={cn(skeletonBlockVariants({active, shape}), "h-4 w-full", className)}
            {...props}
        />
    )
}

// ============================== Avatar ==============================
export interface SkeletonAvatarProps extends Omit<
    React.HTMLAttributes<HTMLDivElement>,
    "children"
> {
    ref?: React.Ref<HTMLDivElement>
    active?: boolean
    size?: SkeletonAvatarSize
    shape?: SkeletonAvatarShape
}

export function SkeletonAvatar({
    className,
    active = false,
    size = "default",
    shape = "circle",
    ...props
}: SkeletonAvatarProps) {
    return (
        <div
            data-slot="skeleton-avatar"
            aria-hidden
            className={cn(
                skeletonBlockVariants({active, shape: shape === "square" ? "square" : "circle"}),
                AVATAR_SIZE[size],
                className,
            )}
            {...props}
        />
    )
}

// ============================== Composite ==============================
type AvatarConfig = Pick<SkeletonAvatarProps, "size" | "shape">
interface TitleConfig {
    width?: string | number
}
interface ParagraphConfig {
    rows?: number
    width?: string | number | (string | number)[]
}

export interface SkeletonProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
    ref?: React.Ref<HTMLDivElement>
    active?: boolean
    /** When explicitly `false`, render `children` instead of the placeholder (antd behaviour). */
    loading?: boolean
    /** antd `round`: blocks use the larger 8px radius. */
    round?: boolean
    avatar?: boolean | AvatarConfig
    title?: boolean | TitleConfig
    paragraph?: boolean | ParagraphConfig
}

const asConfig = <T,>(prop: boolean | T | undefined): T =>
    (prop && typeof prop === "object" ? prop : {}) as T

// antd getTitleBasicProps: title width by avatar/paragraph presence.
const titleWidth = (hasAvatar: boolean, hasParagraph: boolean): string | undefined => {
    if (!hasAvatar && hasParagraph) return "38%"
    if (hasAvatar && hasParagraph) return "50%"
    return undefined
}

// antd getParagraphBasicProps: rows + last-row width by avatar/title presence.
const paragraphDefaults = (hasAvatar: boolean, hasTitle: boolean) => ({
    rows: !hasAvatar && hasTitle ? 3 : 2,
    lastWidth: !hasAvatar || !hasTitle ? "61%" : undefined,
})

export function Skeleton({
    className,
    active = false,
    loading,
    round = false,
    avatar = false,
    title = true,
    paragraph = true,
    children,
    ...props
}: SkeletonProps) {
    if (loading === false) return <>{children}</>

    const hasAvatar = Boolean(avatar)
    const hasTitle = Boolean(title)
    const hasParagraph = Boolean(paragraph)
    const shape = round ? "round" : "block"

    const avatarCfg = asConfig<AvatarConfig>(avatar)
    const titleCfg = asConfig<TitleConfig>(title)
    const paraCfg = asConfig<ParagraphConfig>(paragraph)

    const defaults = paragraphDefaults(hasAvatar, hasTitle)
    const rows = paraCfg.rows ?? defaults.rows
    const tWidth = titleCfg.width ?? titleWidth(hasAvatar, hasParagraph)

    const rowWidth = (i: number): string | number | undefined => {
        if (Array.isArray(paraCfg.width)) return paraCfg.width[i]
        // antd applies width to the last row only.
        if (i === rows - 1) return paraCfg.width ?? defaults.lastWidth
        return undefined
    }

    return (
        <div data-slot="skeleton" aria-hidden className={cn("flex w-full", className)} {...props}>
            {hasAvatar ? (
                <div data-slot="skeleton-header" className="pr-4">
                    <SkeletonAvatar
                        active={active}
                        size={avatarCfg.size ?? "large"}
                        shape={avatarCfg.shape ?? (hasTitle && !hasParagraph ? "square" : "circle")}
                    />
                </div>
            ) : null}
            {hasTitle || hasParagraph ? (
                <div data-slot="skeleton-section" className="w-full min-w-0">
                    {hasTitle ? (
                        // antd renders the title as an <h3>; under preflight-off it keeps the UA
                        // margin-block (1em @ its 14.04px font = 14.04px top+bottom) — that spacing
                        // is part of antd's rendered geometry, so match the tag, not just the bar.
                        // with-avatar overrides the top to marginSM (12px = mt-3); bottom stays UA.
                        <h3
                            data-slot="skeleton-title"
                            style={tWidth != null ? {width: tWidth} : undefined}
                            className={cn(
                                skeletonBlockVariants({active, shape}),
                                "h-3.5 w-full",
                                hasAvatar && "mt-3",
                            )}
                        />
                    ) : null}
                    {hasParagraph ? (
                        <ul
                            data-slot="skeleton-paragraph"
                            // Keep the UA <ul> margin-block (12px) as antd does (it only zeroes
                            // padding); the title→paragraph gap overrides margin-top only.
                            className={cn(
                                "list-none p-0",
                                // antd: title→paragraph gap (with-avatar 28px, else 24px).
                                hasTitle && (hasAvatar ? "mt-7" : "mt-6"),
                            )}
                        >
                            {Array.from({length: rows}).map((_, i) => {
                                const w = rowWidth(i)
                                return (
                                    <li
                                        key={i}
                                        data-slot="skeleton-paragraph-row"
                                        style={w != null ? {width: w} : undefined}
                                        className={cn(
                                            skeletonBlockVariants({active, shape}),
                                            "h-3.5 w-full list-none",
                                            i > 0 && "mt-4",
                                        )}
                                    />
                                )
                            })}
                        </ul>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

export {skeletonBlockVariants}
