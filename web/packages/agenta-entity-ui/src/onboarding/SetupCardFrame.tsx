/**
 * The frame of a setup card: the header (title, badge, dismiss), the body, and the footer (a
 * muted line beside the primary action). Shared by the pre-create "Connect what it needs" card
 * and the chat's "Connect your accounts" card, so both read as the same card.
 */
import type {ReactNode} from "react"

import clsx from "clsx"
import {X} from "@phosphor-icons/react"

export interface SetupCardBadge {
    text: string
    tone: "neutral" | "warning" | "success"
}

export interface SetupCardFrameProps {
    title: string
    badge?: SetupCardBadge | null
    /** The ✕ in the header. Hidden when omitted. */
    onDismiss?: () => void
    dismissLabel?: string
    /** `card` stands alone with its own frame; `docked` sits inside another surface's border. */
    variant?: "card" | "docked"
    /** The muted line in the footer. */
    footnote?: string
    /** The footer's action. The footer is left out when it has neither this nor a footnote. */
    action?: ReactNode
    className?: string
    children: ReactNode
}

export const SetupCardFrame = ({
    title,
    badge,
    onDismiss,
    dismissLabel,
    variant = "card",
    footnote,
    action,
    className,
    children,
}: SetupCardFrameProps) => (
    <div
        className={clsx(
            "flex flex-col",
            variant === "card"
                ? "rounded-xl border border-solid border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)]"
                : // Docked: the host's frame is the frame; only a bottom divider separates
                  // the step from the editor beneath it.
                  "border-x-0 border-b border-t-0 border-solid border-[var(--ag-colorSplit)]",
            className,
        )}
    >
        <div className="flex items-center gap-2 border-x-0 border-t-0 border-b border-solid border-[var(--ag-colorSplit)] px-4 py-3">
            <span className="flex-1 truncate text-xs font-semibold text-[var(--ag-colorText)]">
                {title}
            </span>
            {badge ? (
                <span
                    className={clsx(
                        "shrink-0 rounded-full border border-solid px-2 py-0.5 text-[10px] font-medium",
                        badge.tone === "warning"
                            ? "border-[var(--ag-colorWarningBorder)] text-[var(--ag-colorWarning)]"
                            : badge.tone === "success"
                              ? "border-[var(--ag-colorSuccessBorder)] text-[var(--ag-colorSuccess)]"
                              : "border-[var(--ag-colorBorderSecondary)] text-[var(--ag-colorTextSecondary)]",
                    )}
                >
                    {badge.text}
                </span>
            ) : null}
            {onDismiss ? (
                <button
                    type="button"
                    onClick={onDismiss}
                    aria-label={dismissLabel}
                    title={dismissLabel}
                    className="-mr-1 flex shrink-0 cursor-pointer items-center rounded border-0 bg-transparent p-1 text-[var(--ag-colorTextTertiary)] transition-colors hover:text-[var(--ag-colorText)]"
                >
                    <X size={13} />
                </button>
            ) : null}
        </div>

        {children}

        {/* The footer exists only for what it carries: an empty bordered strip under the rows
            says nothing. */}
        {footnote || action ? (
            <div className="flex flex-wrap items-center justify-end gap-3 border-x-0 border-b-0 border-t border-solid border-[var(--ag-colorSplit)] px-4 py-3">
                {footnote ? (
                    <span className="text-xs text-[var(--ag-colorTextTertiary)]">{footnote}</span>
                ) : null}
                {action}
            </div>
        ) : null}
    </div>
)
