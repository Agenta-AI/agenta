import * as React from "react"

import {cva, type VariantProps} from "class-variance-authority"

import {cn} from "./utils"

/**
 * Skeleton — the shadcn placeholder. `SkeletonBlock` is one bar (size it via className);
 * `Skeleton` is the title + paragraph composite, optionally with an avatar.
 */
const skeletonBlockVariants = cva("block bg-accent", {
    variants: {
        active: {
            true: "animate-pulse",
            false: "",
        },
        shape: {
            block: "rounded-md",
            round: "rounded-lg",
            circle: "rounded-full",
            square: "rounded-none",
        },
    },
    defaultVariants: {active: true, shape: "block"},
})

export type SkeletonAvatarSize = "small" | "default" | "large"
export type SkeletonAvatarShape = "circle" | "square"

const AVATAR_SIZE: Record<SkeletonAvatarSize, string> = {
    small: "size-6",
    default: "size-8",
    large: "size-10",
}

export interface SkeletonBlockProps
    extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof skeletonBlockVariants> {
    ref?: React.Ref<HTMLDivElement>
}

/** One skeleton bar (defaults to a full-width 16px bar); size via className. */
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
    active,
    size = "default",
    shape = "circle",
    ...props
}: SkeletonAvatarProps) {
    return (
        <div
            data-slot="skeleton-avatar"
            aria-hidden
            className={cn(
                skeletonBlockVariants({active, shape: shape === "square" ? "block" : "circle"}),
                "shrink-0",
                AVATAR_SIZE[size],
                className,
            )}
            {...props}
        />
    )
}

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
    /** When explicitly `false`, render `children` instead of the placeholder. */
    loading?: boolean
    round?: boolean
    avatar?: boolean | AvatarConfig
    title?: boolean | TitleConfig
    paragraph?: boolean | ParagraphConfig
}

const asConfig = <T,>(prop: boolean | T | undefined): T =>
    (prop && typeof prop === "object" ? prop : {}) as T

export function Skeleton({
    className,
    active,
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
    const shape = round ? "round" : "block"

    const avatarCfg = asConfig<AvatarConfig>(avatar)
    const titleCfg = asConfig<TitleConfig>(title)
    const paraCfg = asConfig<ParagraphConfig>(paragraph)

    const rows = paraCfg.rows ?? (hasTitle && !hasAvatar ? 3 : 2)
    const rowWidth = (i: number): string | number | undefined => {
        if (Array.isArray(paraCfg.width)) return paraCfg.width[i]
        if (i === rows - 1) return paraCfg.width ?? "60%"
        return undefined
    }

    return (
        <div
            data-slot="skeleton"
            aria-hidden
            className={cn("flex w-full gap-4", className)}
            {...props}
        >
            {hasAvatar ? (
                <SkeletonAvatar
                    active={active}
                    size={avatarCfg.size ?? "large"}
                    shape={avatarCfg.shape ?? "circle"}
                />
            ) : null}
            <div data-slot="skeleton-section" className="flex w-full min-w-0 flex-col gap-3">
                {hasTitle ? (
                    <SkeletonBlock
                        data-slot="skeleton-title"
                        active={active}
                        shape={shape}
                        style={{width: titleCfg.width ?? "40%"}}
                    />
                ) : null}
                {paragraph
                    ? Array.from({length: rows}).map((_, i) => {
                          const w = rowWidth(i)
                          return (
                              <SkeletonBlock
                                  key={i}
                                  data-slot="skeleton-paragraph-row"
                                  active={active}
                                  shape={shape}
                                  className="h-3"
                                  style={w != null ? {width: w} : undefined}
                              />
                          )
                      })
                    : null}
            </div>
        </div>
    )
}

export {skeletonBlockVariants}
