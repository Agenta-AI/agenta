import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from "react"

import {pageContentWidthClass, pageGutterClass} from "@agenta/ui/components/page-width"
import {ArrowSquareOut} from "@phosphor-icons/react"
import clsx from "clsx"

/**
 * SettingsPageShell — the frame every Settings tab renders inside.
 *
 * Standalone by design: it does NOT wrap `PageLayout`. Settings has a sticky, measured header
 * and a mandatory description, neither of which the other 15 PageLayout pages want. Keeping
 * them separate means Settings can evolve without touching Prompts, Agents, Evaluators,
 * Observability or Testsets. The gutters and the centered column are the shared ones
 * (`pageGutterClass` / `pageContentWidthClass`), so Settings lines up with Home and Agents
 * instead of keeping its own scale.
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
     * How wide the body runs inside the shared gutters. `table` (1120px) and `form` (640px)
     * sit inside the shared centered column, so they line up with Home and Agents; both are
     * left-anchored, so eye travel from the nav rail stays constant. `full` (default) opts
     * out of the centered column entirely — it exists for the Audit Log, whose timestamp +
     * event type + full UUID row is the one thing here that wants the whole monitor.
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
    const headerRef = useRef<HTMLElement>(null)
    // What the page header occupies once pinned, published as `--ag-sticky-top` so each
    // section's own sticky header (DataTable) parks beneath it instead of sliding under.
    // Measured, not a constant: a long description wraps, and the two would drift apart.
    const [headerHeight, setHeaderHeight] = useState(0)

    useEffect(() => {
        const node = headerRef.current
        if (!node || typeof ResizeObserver === "undefined") return
        const observer = new ResizeObserver(([entry]) => setHeaderHeight(entry.contentRect.height))
        observer.observe(node)
        return () => observer.disconnect()
    }, [])

    return (
        <div
            style={{"--ag-sticky-top": `${headerHeight}px`} as CSSProperties}
            className={clsx(
                "flex min-w-0 flex-col self-stretch",
                // Same gutters + centered column as every PageLayout page, so Settings shares
                // Home's insets instead of keeping its own responsive scale, and `full` means
                // "the shared column" rather than "however wide the monitor is".
                pageGutterClass,
                // `full` keeps the gutters but escapes the centered cap: it exists for the
                // Audit Log, whose timestamp + event type + full UUID row is the one thing on
                // this page that wants the whole monitor. Capping it here would re-lose the
                // width that moving Audit Log onto its own scroll was for.
                variant !== "full" && pageContentWidthClass,
                // The app's body scale, stated rather than inherited, because mobile has no
                // antd and was rendering every Settings tab at the browser's 16px default.
                // These are antd's `fontSize`/`lineHeight` as the app actually configures
                // them (antd-themeConfig.json: 14 / 1.4285714) — an earlier 12px/1.667 here
                // rendered the whole page a step below the desktop app.
                "text-[14px] leading-[1.4285714285714286]",
                fullHeight ? "h-full min-h-0" : "min-h-full",
            )}
        >
            <div
                className={clsx(
                    "flex w-full min-w-0 flex-col gap-6",
                    fullHeight && "min-h-0 flex-1",
                )}
            >
                {/* Pinned: the tab you are on stays named however far its sections run. `pt-4`
                    with a matching negative margin keeps the resting layout identical and buys
                    clearance above the title once it is stuck against the container edge.
                    Below `lg` the docs link stacks under the description so it cannot pinch
                    the title into "AI provid…" the way a `shrink-0` sibling did on phones. */}
                <header
                    ref={headerRef}
                    className="sticky top-0 z-20 -mt-4 flex flex-col items-stretch gap-3 border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer pb-6 pt-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6"
                >
                    <div className="flex min-w-0 flex-col gap-1">
                        {/* antd's heading-3 (24px / 1.3333 / 600) as literals, not `--ant-*`
                            vars: those exist only where antd runs, so on mobile the heading
                            fell back to body text and the hierarchy collapsed. The literals
                            are 20/1.4 no longer — that was heading-4's size, and it shipped a
                            title a full step below prod's. `m-0` kills the UA margin
                            (preflight is off). */}
                        <h1 className="m-0 truncate text-[24px] font-semibold leading-[1.3333333333333333] text-colorText">
                            {title}
                        </h1>
                        <p className="m-0 text-colorTextSecondary">{description}</p>
                    </div>

                    {docs ? (
                        <a
                            className="flex shrink-0 items-center gap-1 self-start text-colorTextSecondary no-underline hover:text-colorText lg:mt-1"
                            href={docs.href}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {docs.label}
                            <ArrowSquareOut size={14} />
                        </a>
                    ) : null}
                </header>

                {/* The variant cap lives on the content only, so the header + its divider span
                    the full shared column while the body stays left-anchored at its own width. */}
                <div
                    className={clsx(
                        "flex min-w-0 flex-col",
                        fullHeight && "min-h-0 flex-1",
                        variant === "form" && "max-w-[640px]",
                        variant === "table" && "max-w-[1120px]",
                    )}
                >
                    {children}
                </div>
            </div>
        </div>
    )
}

export default SettingsPageShell
