import type {ReactNode} from "react"

import type {SessionRowVm} from "@agenta/sessions/row"
import type {SessionMenuEntry} from "@agenta/sessions-ui"
import {SessionListPanel} from "@agenta/sessions-ui"
import {PanelScroll, PanelSurface} from "@agenta/ui/components/presentational"

export interface HomeOverviewProps {
    /** The hero line. */
    title: string
    /** The standing action beside the hero — "+ New agent". */
    action?: ReactNode
    /** Start a task: the app's composer. Both apps render the same chat composer beneath it. */
    composer?: ReactNode
    /** Where the session cards' "View all" lands. */
    sessionsHref: string
    /** Host verbs for a session row — identical contract on both apps. */
    onOpenSession: (vm: SessionRowVm) => void
    sessionMenuFor?: (vm: SessionRowVm) => SessionMenuEntry[]
    onSessionMenuSelect?: (vm: SessionRowVm, key: string) => void
    /** Touch has no hover, so the pin must stay visible there. */
    alwaysShowPin?: boolean
    /** The rail, top to bottom: agents, next triggers, usage. Apps pass what they can render. */
    agentsPanel?: ReactNode
    triggersPanel?: ReactNode
    usagePanel?: ReactNode
}

const SESSIONS_LIMIT = 6
const AUTOMATIONS_LIMIT = 5

/**
 * Home, for every viewport and both apps.
 *
 * ONE composition: the hero and the composer, then what is in flight (your sessions, then the
 * automation runs) in the main column, with what you could start (agents, next triggers, usage)
 * in the rail beside it. Below `lg` the rail stops being a column and simply follows the main
 * one, so a phone reads the same page in the same order rather than a different page.
 *
 * The rail is a third of the width rather than a fixed 400px, which held its proportion only at
 * one screen size — it read as a third on a large display and as a slab on a laptop.
 *
 * The page's own insets live HERE and nowhere else, so both apps inset identically. A host that
 * wraps this in a padded frame (the desktop `PageLayout`, which carries `p-4`) must cancel that
 * frame's padding — otherwise its copy of the page sits 16px further in on every side than the
 * other app's, which is exactly the drift this component exists to prevent.
 */
export const HomeOverview = ({
    title,
    action,
    composer,
    sessionsHref,
    onOpenSession,
    sessionMenuFor,
    onSessionMenuSelect,
    alwaysShowPin,
    agentsPanel,
    triggersPanel,
    usagePanel,
}: HomeOverviewProps) => (
    // The top inset is the CONTENT's, not this scroller's: a scroll container's padding-top pushes
    // its `sticky top-0` children down by that much, and rows bleed through the band above them.
    <div className="flex min-h-0 w-full flex-1 flex-col gap-10 overflow-y-auto px-4 pb-6 lg:flex-row lg:overflow-hidden lg:pb-6 lg:pl-[72px] lg:pr-14 lg:pt-12">
        {/* `min-w-0` or a wide card would push the column past its share. */}
        <div className="box-border flex min-w-0 flex-1 flex-col gap-14 pt-6 lg:overflow-y-auto lg:pr-4 lg:pt-0">
            <div className="flex w-full flex-col">
                {/* The hero line carries the page's standing action. On its own row above
                    everything it cost a full band of empty width and pushed the question it
                    belongs beside downward. */}
                <div className="flex items-center justify-between gap-4">
                    <h1 className="m-0 text-[20px] font-semibold leading-tight text-colorText">
                        {title}
                    </h1>
                    {action}
                </div>

                {composer ? (
                    <div className="relative mt-8 flex flex-col items-stretch">{composer}</div>
                ) : null}
            </div>

            {/* Bare, on the page background: the rail is the page's one defined object, and a
                second sheet opposite it made both read as equal weight. */}
            <div className="flex flex-col gap-10">
                <SessionListPanel
                    withPinned
                    title="Sessions"
                    limit={SESSIONS_LIMIT}
                    minHeightClassName="min-h-[220px]"
                    emptyText="Your conversations will show up here."
                    viewAllHref={sessionsHref}
                    onOpenRow={onOpenSession}
                    menuFor={sessionMenuFor}
                    onMenuSelect={onSessionMenuSelect}
                    alwaysShowPin={alwaysShowPin}
                />
                {/*
                 * What the automations actually did — the sessions they produced, not a schedule
                 * of what's next. A completed run can need attention; an upcoming one never does.
                 *
                 * Pinned runs lead here too. The pinned query carries `origin`, so it stays this
                 * card's own set — the Sessions card still excludes trigger-origin sessions.
                 *
                 * The min-height sits barely above the empty state's own: a taller floor on a
                 * one-row card leaves dead space that reads as a rendering failure.
                 */}
                <SessionListPanel
                    withPinned
                    origin="trigger"
                    title="Automation runs"
                    limit={AUTOMATIONS_LIMIT}
                    minHeightClassName="min-h-[100px]"
                    emptyText="Runs from your automations will show up here."
                    viewAllHref={sessionsHref}
                    onOpenRow={onOpenSession}
                    menuFor={sessionMenuFor}
                    onMenuSelect={onSessionMenuSelect}
                    alwaysShowPin={alwaysShowPin}
                />
            </div>
        </div>

        {agentsPanel || triggersPanel || usagePanel ? (
            <div className="box-border flex min-h-0 w-full shrink-0 grow-0 flex-col lg:w-1/3 lg:min-w-[340px] lg:max-w-[520px] lg:pr-1">
                <PanelSurface className="flex max-h-full min-h-0 flex-col">
                    <PanelScroll>
                        {agentsPanel}
                        {/* Forward-looking, unlike the automation RUNS in the main column: a
                            schedule that stopped firing is invisible in a list of things that
                            already happened. */}
                        {triggersPanel}
                        {/* Usage sits with what you could start, not with what is in flight — it
                            is the column you glance at, not work from. */}
                        {usagePanel}
                    </PanelScroll>
                </PanelSurface>
            </div>
        ) : null}
    </div>
)
