import {useEffect, useRef, useState, type CSSProperties, type ReactNode} from "react"

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
     * Content cap. `full` (default) = no cap. `table` = 1120px, `form` = 640px. Caps the
     * body only — the header and its divider always span the full page width. All
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
                "flex w-full flex-col self-stretch",
                // Gutter: 16 / 24 / 32 / 40 as the viewport widens, replacing the flat 16px
                // every Settings page used to inherit at every size. Vertical rhythm is
                // fixed (32 top, 64 bottom).
                "px-4 pt-8 pb-16 md:px-6 lg:px-8 xl:px-10",
                // The app's body scale, stated rather than inherited: on the desktop it comes
                // from antd's 12px/1.667 base, and mobile — which has no antd — was rendering
                // every Settings tab at the browser's 16px default.
                "text-[12px] leading-[1.6666666666666667]",
                fullHeight ? "h-full min-h-0" : "min-h-full",
            )}
        >
            <div className={clsx("flex w-full flex-col gap-6", fullHeight && "min-h-0 flex-1")}>
                {/* Pinned: the tab you are on stays named however far its sections run. `pt-4`
                    with a matching negative margin keeps the resting layout identical and buys
                    clearance above the title once it is stuck against the container edge. */}
                <header
                    ref={headerRef}
                    className="sticky top-0 z-20 -mt-4 flex items-start justify-between gap-6 border-0 border-b border-solid border-colorBorderSecondary bg-colorBgContainer pb-6 pt-4"
                >
                    <div className="flex min-w-0 flex-col gap-1">
                        {/* antd's heading-3 (20px / 1.4 / 600) as literals, not `--ant-*` vars:
                            those exist only where antd runs, so on mobile the heading fell back
                            to body text and the hierarchy collapsed. `m-0` kills the UA margin
                            (preflight is off). */}
                        <h1 className="m-0 truncate text-[20px] font-semibold leading-[1.4] text-colorText">
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

                {/* The cap lives on the content only, so the header + its divider span the
                    full page width while the body stays left-anchored at its variant width. */}
                <div
                    className={clsx(
                        "flex flex-col",
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
