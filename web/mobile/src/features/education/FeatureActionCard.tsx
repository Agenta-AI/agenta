import type {ReactNode} from "react"

import {ArrowRight} from "@phosphor-icons/react"

import {cn} from "@/lib/utils"

/** A way to start, styled like a template card: icon tiles, what it does, and where it leads. */
export const FeatureActionCard = ({
    icons,
    title,
    description,
    actionLabel,
    meta,
    onClick,
}: {
    icons: ReactNode[]
    title: string
    description: string
    actionLabel: string
    meta: string
    onClick: () => void
}) => (
    <button
        type="button"
        onClick={onClick}
        className="box-border flex min-w-0 cursor-pointer flex-col rounded-xl border border-solid border-colorBorderSecondary bg-background px-4 pb-0 pt-4 text-left transition-[border-color,box-shadow] hover:border-border hover:shadow-[0_2px_8px_-2px_color-mix(in_srgb,var(--ag-colorText)_12%,transparent)]"
    >
        <span className="flex h-[30px] items-center">
            {icons.map((icon, index) => (
                <span
                    key={index}
                    aria-hidden
                    className={cn(
                        "box-border inline-flex size-[30px] shrink-0 items-center justify-center rounded-[9px] border border-solid border-colorBorderSecondary bg-background text-foreground",
                        index > 0 && "-ml-1.5",
                    )}
                >
                    {icon}
                </span>
            ))}
        </span>
        <span className="mt-3.5 text-[15px] font-medium text-foreground">{title}</span>
        <span className="mt-1.5 line-clamp-2 min-h-10 text-[13.5px] leading-[1.5] text-muted-foreground">
            {description}
        </span>
        <span className="mt-3 flex h-10 items-center justify-between gap-3 border-0 border-t border-solid border-colorBorderSecondary text-[12.5px] text-colorTextTertiary">
            <span className="flex min-w-0 items-center gap-1.5">
                <ArrowRight className="size-[13px] shrink-0 text-colorTextQuaternary" aria-hidden />
                <span className="truncate">{actionLabel}</span>
            </span>
            <span className="shrink-0">{meta}</span>
        </span>
    </button>
)
