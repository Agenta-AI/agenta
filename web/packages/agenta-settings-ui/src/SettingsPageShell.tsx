import {createContext, useContext, useState, type ReactNode} from "react"

import {ArrowSquareOut} from "@phosphor-icons/react"
import clsx from "clsx"
import {createPortal} from "react-dom"

/**
 * SettingsPageShell — the frame every Settings tab renders inside.
 *
 * Standalone by design: it does NOT wrap `PageLayout`. Settings has a mandatory description the
 * other PageLayout pages do not want, so the two evolve separately.
 *
 * One centered column, 1040px including its gutters, for every tab: the title, then the body.
 * A tab's primary action rides the title row through {@link SettingsPageActions}; search and
 * filters stay in the list's own toolbar.
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
     * How wide the body runs. `table` fills the centered column; `form` caps the body at 640px
     * inside it, so fields do not run the column; `full` drops the column cap for the Audit Log,
     * whose timestamp + event type + full UUID row wants the whole monitor.
     */
    variant?: "full" | "table" | "form"
    /**
     * Bound the page height so a table that scrolls internally does not grow the page.
     * Needed by tabs hosting a virtualized table.
     */
    fullHeight?: boolean
    children: ReactNode
}

/** Where a tab's primary action renders: the header's slot inside a shell, `undefined` outside one. */
const HeaderActionsContext = createContext<HTMLElement | null | undefined>(undefined)

/**
 * A tab's primary action, drawn on the shell's title row. The tab keeps owning the state the
 * button opens; outside a shell (a host without one) it renders in place, right-aligned.
 */
export const SettingsPageActions = ({children}: {children: ReactNode}) => {
    const target = useContext(HeaderActionsContext)
    if (target === undefined) return <div className="mb-3 flex justify-end gap-2">{children}</div>
    return target ? createPortal(children, target) : null
}

const SettingsPageShell = ({
    title,
    description,
    docs,
    variant = "full",
    fullHeight,
    children,
}: SettingsPageShellProps) => {
    const [actionsSlot, setActionsSlot] = useState<HTMLDivElement | null>(null)
    return (
        <div
            className={clsx(
                // `box-border` because preflight is off: `w-full` plus padding would overflow.
                "box-border flex w-full flex-col self-stretch px-4 pb-16 pt-6 sm:px-8 lg:px-14 lg:pt-11",
                variant !== "full" && "mx-auto max-w-[1040px]",
                // The app's body scale, stated rather than inherited: mobile has no antd and would
                // otherwise render every Settings tab at the browser's 16px default.
                "text-[14px] leading-[1.4285714285714286]",
                fullHeight ? "h-full min-h-0" : "min-h-full",
            )}
        >
            <header className="mb-7 flex flex-col gap-1.5">
                <div className="flex min-w-0 items-center justify-between gap-4">
                    {/* Below `sm` the title drops to the 16px body ramp, like every page title on a
                    phone. `m-0` kills the UA margin (preflight is off). */}
                    <h1 className="m-0 min-w-0 truncate text-[16px] font-semibold leading-[1.5] tracking-[-0.01em] text-colorText sm:text-[24px] sm:leading-8">
                        {title}
                    </h1>

                    <div className="flex shrink-0 items-center gap-4">
                        {docs ? (
                            <a
                                className="flex shrink-0 items-center gap-1.5 text-[13px] text-colorTextSecondary no-underline hover:text-colorText"
                                href={docs.href}
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                {docs.label}
                                <ArrowSquareOut size={13} />
                            </a>
                        ) : null}
                        <div
                            ref={setActionsSlot}
                            className="flex items-center gap-2 empty:hidden"
                        />
                    </div>
                </div>
                <p className="m-0 text-[14px] leading-5 text-colorTextSecondary">{description}</p>
            </header>

            <div
                className={clsx(
                    "flex flex-col",
                    fullHeight && "min-h-0 flex-1",
                    variant === "form" && "max-w-[640px]",
                )}
            >
                <HeaderActionsContext.Provider value={actionsSlot}>
                    {children}
                </HeaderActionsContext.Provider>
            </div>
        </div>
    )
}

export default SettingsPageShell
