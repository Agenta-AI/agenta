/**
 * Small presentational pieces shared by the catalog / execution drawers — the antd
 * `Card hoverable size="small"` and `Typography.Paragraph ellipsis(expandable)` these
 * drawers used, re-expressed on tokens (no @agenta/ui primitive exists for either).
 */
import {useState} from "react"

import {cn} from "@agenta/ui"

/** antd `Card hoverable size="small"` replacement — bordered surface, shadow on hover. */
export function CatalogCard({
    className,
    onClick,
    children,
}: {
    className?: string
    onClick?: () => void
    children: React.ReactNode
}) {
    return (
        <div
            onClick={onClick}
            className={cn(
                "box-border rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer p-3",
                "transition-shadow hover:shadow-tertiary",
                className,
            )}
        >
            {children}
        </div>
    )
}

/** 3-line clamp with a "see more" / "see less" toggle (was antd Paragraph ellipsis). */
export function ExpandableText({text}: {text: string}) {
    const [expanded, setExpanded] = useState(false)
    return (
        <div className="flex flex-col items-start">
            <p className={cn("m-0 text-xs text-colorTextSecondary", !expanded && "line-clamp-3")}>
                {text}
            </p>
            <button
                type="button"
                onClick={() => setExpanded((e) => !e)}
                className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-xs text-colorPrimary"
            >
                {expanded ? "see less" : "see more"}
            </button>
        </div>
    )
}
