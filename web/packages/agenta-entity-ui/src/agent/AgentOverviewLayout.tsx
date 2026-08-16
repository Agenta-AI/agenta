import type {ReactNode} from "react"

import clsx from "clsx"

export interface AgentOverviewLayoutProps {
    /** The reading column: what happened — the activity lists, and a composer where the host has one. */
    main: ReactNode
    /** The rail: what the agent IS — configuration, files, triggers, usage. Each host brings the
     * cards it can serve; the layout only places them. */
    rail: ReactNode
    /**
     * The frame owns the height and each column scrolls on its own (the desktop page, which is a
     * full-height frame). Default: both columns are plain blocks and the host's page scrolls —
     * nesting a scroller inside an already-scrolling screen strands the rail, which is the bug
     * `ScreenScaffold`'s `fill` exists to avoid on mobile.
     */
    scroll?: boolean
    /** Host spacing — the stacked gap below lg is content rhythm, not layout. */
    className?: string
}

/**
 * THE agent overview arrangement, shared by the desktop page and the mobile screen: activity
 * reads in a flexible left column, the agent's own state stands as a fixed-width rail beside it,
 * and the two stack below lg. One definition so the two surfaces cannot drift — the components
 * inside the slots are already shared (`AgentConfigSummaryCard`, `NextTriggersSection`,
 * `SessionCardList`); this is the composition that was still being written twice.
 */
export const AgentOverviewLayout = ({
    main,
    rail,
    scroll = false,
    className,
}: AgentOverviewLayoutProps) => (
    <div
        className={clsx(
            "flex w-full flex-col items-start gap-10 lg:flex-row",
            scroll && "min-h-0 flex-1 overflow-y-auto lg:overflow-hidden",
            className,
        )}
    >
        <div
            className={clsx(
                "flex w-full min-w-0 flex-col gap-6 lg:flex-1",
                scroll && "lg:h-full lg:overflow-y-auto lg:pr-4",
            )}
        >
            {main}
        </div>
        <div
            className={clsx(
                "flex w-full shrink-0 grow-0 flex-col lg:w-1/3 lg:min-w-[340px] lg:max-w-[520px]",
                scroll && "min-h-0 lg:h-full lg:pr-1",
            )}
        >
            {rail}
        </div>
    </div>
)
