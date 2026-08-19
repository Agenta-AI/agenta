import type {ReactNode} from "react"

import {pageContentWidthClass, pageGutterClass} from "@agenta/ui/components/page-width"
import {ArrowSquareOut} from "@phosphor-icons/react"
import clsx from "clsx"

/**
 * SettingsPageShell — the frame every Settings tab renders inside.
 *
 * Standalone by design: it does NOT wrap `PageLayout`. Settings has its own gutter scale
 * and a mandatory description, neither of which the other 15 PageLayout pages want. Keeping
 * them separate means Settings can evolve without touching Prompts, Agents, Evaluators,
 * Observability or Testsets. The content cap is the shared one (`pageContentWidthClass`).
 *
 * Renders the gutter, the centered content column and the header. Each tab's search and
 * actions live in its own table shell (`filters` / `primaryActions`), not in the central
 * page switch.
 */
export interface SettingsPageShellProps {
    title: ReactNode
    /**
     * One sentence explaining what the page is for. Required — a Settings tab without a
     * description is the single most common gap this shell exists to close.
     */
    description: ReactNode
    /** Optional tertiary docs link, rendered at the far right of the header. */
    docs?: {label: string; href: string}
    /**
     * Body width inside the shared centered column. `full` (default) fills it; `form` caps
     * at 640px, left-anchored, because a form field wider than that is unreadable.
     */
    variant?: "full" | "form"
    /**
     * Bound the page height so a table that scrolls internally does not grow the page.
     * Needed by tabs hosting a virtualized table.
     */
    fullHeight?: boolean
    children: ReactNode
}

const SettingsPageShell = ({
    title,
    description,
    docs,
    variant = "full",
    fullHeight,
    children,
}: SettingsPageShellProps) => {
    return (
        <div
            className={clsx(
                "flex flex-col self-stretch",
                // Same gutters + centered column as every PageLayout page, so Settings lines up
                // with the rest of the app instead of keeping its own scale.
                pageGutterClass,
                pageContentWidthClass,
                fullHeight ? "h-full min-h-0" : "min-h-full",
            )}
        >
            <div className={clsx("flex flex-col gap-6", fullHeight && "min-h-0 flex-1")}>
                <header className="flex items-start justify-between gap-6 border-0 border-b border-solid border-colorBorderSecondary pb-6">
                    <div className="flex min-w-0 flex-col gap-1">
                        {/* Sized off antd's own heading tokens so it scales and flips with
                            the theme. `m-0` kills the UA margin (preflight is off). */}
                        <h1
                            className="m-0 truncate text-colorText"
                            style={{
                                fontSize: "var(--ant-font-size-heading-3)",
                                lineHeight: "var(--ant-line-height-heading-3)",
                                fontWeight: "var(--ant-font-weight-strong)",
                            }}
                        >
                            {title}
                        </h1>
                        <p className="m-0 text-colorTextSecondary">{description}</p>
                    </div>

                    {docs ? (
                        <a
                            className="mt-1 flex shrink-0 items-center gap-1 text-colorTextSecondary no-underline hover:text-colorText"
                            href={docs.href}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {docs.label}
                            <ArrowSquareOut size={14} />
                        </a>
                    ) : null}
                </header>

                <div
                    className={clsx(
                        "flex flex-col",
                        fullHeight && "min-h-0 flex-1",
                        variant === "form" && "max-w-[640px]",
                    )}
                >
                    {children}
                </div>
            </div>
        </div>
    )
}

export default SettingsPageShell
