import type {ReactNode} from "react"

import clsx from "clsx"

export interface AgentOverviewLayoutProps {
    /** The reading column: what happened — the activity lists, and a composer where the host has one. */
    main: ReactNode
    /** The rail: what the agent IS — configuration, files, triggers, usage. Each host brings the
     * cards it can serve; the layout only places them. */
    rail: ReactNode
    /** Host spacing — the stacked gap below lg is content rhythm, not layout. */
    className?: string
}

/**
 * THE agent overview arrangement, shared by the desktop page and the mobile screen: activity
 * reads in a flexible left column, the agent's own state stands as a fixed-width rail beside it,
 * and the two stack below lg. One definition so the two surfaces cannot drift — the components
 * inside the slots are already shared (`AgentConfigSummaryCard`, `NextTriggersSection`,
 * `SessionCardList`); this is the composition that was still being written twice.
 *
 * ONE scroller, and it is this frame — not the host's page, and not one per column. The columns
 * used to scroll independently, which put two scrollbars side by side and left them disagreeing
 * about where the top was; letting the page scroll instead pushed the whole surface, header and
 * all, off the screen. So the frame takes the height its host gives it and both columns move
 * together inside it. The host must therefore bound this: give it a parent with a definite
 * height (the desktop page asks the layout for its full-height frame, mobile's `ScreenScaffold`
 * takes `fill`), or `flex-1` has no space to resolve against.
 */
export const AgentOverviewLayout = ({main, rail, className}: AgentOverviewLayoutProps) => (
    <div
        className={clsx(
            "flex min-h-0 w-full flex-1 flex-col items-start gap-10 overflow-y-auto lg:flex-row",
            className,
        )}
    >
        <div className="flex w-full min-w-0 flex-col gap-6 lg:flex-1">{main}</div>
        <div className="flex w-full shrink-0 grow-0 flex-col lg:w-1/3 lg:min-w-[340px] lg:max-w-[520px]">
            {rail}
        </div>
    </div>
)
