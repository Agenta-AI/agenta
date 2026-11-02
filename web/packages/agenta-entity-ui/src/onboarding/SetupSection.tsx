/**
 * One section of a setup card: a slim header (state icon, title, state text, chevron) over a body
 * that folds. Shared by the template card's rows and the chat's "Connect your accounts" rows.
 */
import type {ReactNode} from "react"

import {HeightCollapse} from "@agenta/ui/height-collapse"
import {CaretDown, CheckCircle, Circle} from "@phosphor-icons/react"
import clsx from "clsx"

export interface SetupSectionProps {
    /** `done` draws the success check; `warning` an amber circle; `idle` a tertiary circle. */
    icon: "done" | "warning" | "idle"
    title: ReactNode
    /** Secondary text right after the title. */
    titleExtra?: ReactNode
    /** The state after the title ("Connected", "Optional", ...); a node may stand in for it. */
    state?: ReactNode
    stateTone?: "success" | "warning" | "muted"
    /** The body is shown. */
    open: boolean
    /** The header was tapped. Omitted = not collapsible. */
    onToggle?: () => void
    /** Open and in need of attention: the warning wash. */
    highlight?: boolean
    children?: ReactNode
    /** Rendered after the section, outside the fold (a drawer). */
    after?: ReactNode
}

export const SetupSection = ({
    icon,
    title,
    titleExtra,
    state,
    stateTone = "muted",
    open,
    onToggle,
    highlight = false,
    children,
    after,
}: SetupSectionProps) => (
    <div
        className={clsx(
            "border-x-0 border-b border-t-0 border-solid border-[var(--ag-colorSplit)] transition-colors last:border-b-0",
            open && highlight && "bg-[var(--ag-colorWarningBg)]",
        )}
    >
        <button
            type="button"
            onClick={onToggle}
            disabled={!onToggle}
            aria-expanded={onToggle ? open : undefined}
            className={clsx(
                "flex min-h-11 w-full items-center gap-2.5 border-0 bg-transparent px-1 py-1 text-left",
                onToggle ? "cursor-pointer" : "cursor-default",
            )}
        >
            {icon === "done" ? (
                <CheckCircle
                    size={15}
                    weight="fill"
                    className="shrink-0 text-[var(--ag-colorSuccess)]"
                />
            ) : (
                <Circle
                    size={15}
                    className={clsx(
                        "shrink-0",
                        icon === "warning"
                            ? "text-[var(--ag-colorWarning)]"
                            : "text-[var(--ag-colorTextTertiary)]",
                    )}
                />
            )}
            <span className="truncate text-xs font-medium text-[var(--ag-colorText)]">{title}</span>
            {titleExtra ? (
                <span className="shrink-0 truncate text-[11px] text-[var(--ag-colorTextSecondary)]">
                    {titleExtra}
                </span>
            ) : null}
            {state ? (
                <span
                    className={clsx(
                        "shrink-0 text-[11px]",
                        stateTone === "success"
                            ? "text-[var(--ag-colorSuccess)]"
                            : stateTone === "warning"
                              ? "text-[var(--ag-colorWarning)]"
                              : "text-[var(--ag-colorTextTertiary)]",
                    )}
                >
                    {state}
                </span>
            ) : null}
            <span className="flex-1" />
            {onToggle ? (
                <CaretDown
                    size={13}
                    className={clsx(
                        "shrink-0 text-[var(--ag-colorTextTertiary)] transition-transform",
                        open && "rotate-180",
                    )}
                />
            ) : null}
        </button>
        {children ? (
            <HeightCollapse open={open} fade>
                <div className="flex flex-col gap-2.5 pb-3 pl-[26px] pr-1">{children}</div>
            </HeightCollapse>
        ) : null}
        {after}
    </div>
)
