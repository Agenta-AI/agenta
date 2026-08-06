import type {ReactNode} from "react"

import {ArrowSquareOut} from "@phosphor-icons/react"
import clsx from "clsx"

/**
 * SettingsPageShell — the frame every Settings tab renders inside.
 *
 * Standalone by design: it does NOT wrap `PageLayout`. Settings has its own gutter scale,
 * its own content cap, and a mandatory description, none of which the other 15 PageLayout
 * pages want. Keeping them separate means Settings can evolve without touching Prompts,
 * Agents, Evaluators, Observability or Testsets.
 *
 * Renders the gutter, the content cap and the header. Each tab's search and actions live
 * in its own table shell (`filters` / `primaryActions`), not in the central page switch.
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
     * Content cap. `full` (default) = no cap. `table` = 1120px, `form` = 640px. All
     * left-anchored, so eye travel from the nav rail to the content stays constant.
     */
    variant?: "full" | "table" | "form"
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
                "flex w-full flex-col self-stretch",
                // Gutter: 16 / 24 / 32 / 40 as the viewport widens, replacing the flat 16px
                // every Settings page used to inherit at every size. Vertical rhythm is
                // fixed (32 top, 64 bottom).
                "px-4 pt-8 pb-16 md:px-6 lg:px-8 xl:px-10",
                fullHeight ? "h-full min-h-0" : "min-h-full",
            )}
        >
            <div
                className={clsx(
                    "flex w-full flex-col gap-6",
                    fullHeight && "min-h-0 flex-1",
                    variant === "form" && "max-w-[640px]",
                    variant === "table" && "max-w-[1120px]",
                )}
            >
                <header className="flex items-start justify-between gap-6 border-0 border-b border-solid border-colorBorderSecondary pb-6">
                    <div className="flex min-w-0 flex-col gap-1">
                        {/* Sized off antd's own heading tokens so it scales and flips with
                            the theme. `m-0` kills the UA margin (preflight is off). */}
                        <h1
                            className="m-0 truncate"
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

                <div className={clsx("flex flex-col", fullHeight && "min-h-0 flex-1")}>
                    {children}
                </div>
            </div>
        </div>
    )
}

export default SettingsPageShell
