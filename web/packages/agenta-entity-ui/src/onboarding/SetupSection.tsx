/**
 * One section of a setup card: a slim header (state icon, title, state text, chevron) over a body
 * that folds. Shared by the template card's rows and the chat's "Connect your accounts" rows.
 */
import type {ReactNode} from "react"

import {HeightCollapse} from "@agenta/ui/layout"
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
            "border-x-0 border-b border-t-0 border-solid border-border-muted transition-colors last:border-b-0",
            open && highlight && "bg-warning/10",
        )}
    >
        <button
            type="button"
            onClick={onToggle}
            disabled={!onToggle}
            aria-expanded={onToggle ? open : undefined}
            className={clsx(
                "flex min-h-row-single w-full items-center gap-2 border-0 bg-transparent px-0 py-1 text-left",
                onToggle ? "cursor-pointer" : "cursor-default",
            )}
        >
            {icon === "done" ? (
                <CheckCircle size={16} weight="fill" className="shrink-0 text-success" />
            ) : (
                <Circle
                    size={16}
                    className={clsx(
                        "shrink-0",
                        icon === "warning" ? "text-warning" : "text-muted-foreground",
                    )}
                />
            )}
            <span className="truncate text-label font-medium text-foreground">{title}</span>
            {titleExtra ? (
                <span className="shrink-0 truncate text-caption text-muted-foreground">
                    {titleExtra}
                </span>
            ) : null}
            {state ? (
                <span
                    className={clsx(
                        "shrink-0 text-caption",
                        stateTone === "success"
                            ? "text-success"
                            : stateTone === "warning"
                              ? "text-warning"
                              : "text-muted-foreground",
                    )}
                >
                    {state}
                </span>
            ) : null}
            <span className="flex-1" />
            {onToggle ? (
                <CaretDown
                    size={12}
                    className={clsx(
                        "shrink-0 text-muted-foreground transition-transform",
                        open && "rotate-180",
                    )}
                />
            ) : null}
        </button>
        {children ? (
            <HeightCollapse open={open} fade>
                <div className="flex flex-col gap-2 pb-3 pl-6 pr-1">{children}</div>
            </HeightCollapse>
        ) : null}
        {after}
    </div>
)
