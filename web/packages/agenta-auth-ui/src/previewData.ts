/** The demo content of the sign-in preview: six agency and team automations and the run loop's clock. */
import type {ComponentType} from "react"

import {ListChecks, NotePencil, Tag, type IconProps} from "@phosphor-icons/react"

export type Icon = ComponentType<IconProps>
export type AppId =
    | "slack"
    | "notion"
    | "gmail"
    | "google_analytics"
    | "googleads"
    | "facebook"
    | "linkedin"
    | "twitter"
    | "google_search_console"
    | "composio_search"

/** Brand marks from the same logo CDN the Templates page uses. */
export const logoUrl = (app: AppId) => `https://logos.composio.dev/api/${app}`

/** The six demo automations. Their text is in the `auth.previewDemo` catalog, keyed by id. */
export type DemoId =
    | "supportTriage"
    | "clientReport"
    | "adSpend"
    | "socialPost"
    | "competitorWatch"
    | "seoContent"

/** One tool call, as the playground's activity timeline shows it. */
export interface Step {
    /** Picks the step's text: `<id>Step<n>Running` and `<id>Step<n>Done`. */
    n: 1 | 2 | 3
    /** A connected app's logo, or the kind glyph for the agent's own tools. */
    icon: AppId | Icon
}

/** Past runs, shown as sessions in the sidebar. */
export type SessionKey =
    | "supportTriageSession1"
    | "supportTriageSession2"
    | "clientReportSession1"
    | "clientReportSession2"
    | "adSpendSession1"

export interface Automation {
    id: DemoId
    apps: AppId[]
    /** Minutes since the last run, before the preview has run it itself. */
    lastRunMinutes: number
    steps: [Step, Step, Step]
    sessions: SessionKey[]
}

const steps = (a: AppId | Icon, b: AppId | Icon, c: AppId | Icon): [Step, Step, Step] => [
    {n: 1, icon: a},
    {n: 2, icon: b},
    {n: 3, icon: c},
]

export const AUTOMATIONS: Automation[] = [
    {
        id: "supportTriage",
        apps: ["slack"],
        lastRunMinutes: 4,
        steps: steps("slack", Tag, "slack"),
        sessions: ["supportTriageSession1", "supportTriageSession2"],
    },
    {
        id: "clientReport",
        apps: ["google_analytics", "googleads", "gmail"],
        lastRunMinutes: 9,
        steps: steps("google_analytics", "googleads", "gmail"),
        sessions: ["clientReportSession1", "clientReportSession2"],
    },
    {
        id: "adSpend",
        apps: ["googleads", "facebook", "slack"],
        lastRunMinutes: 22,
        steps: steps("facebook", "googleads", "slack"),
        sessions: ["adSpendSession1"],
    },
    {
        id: "socialPost",
        apps: ["linkedin", "twitter", "notion"],
        lastRunMinutes: 95,
        steps: steps("notion", NotePencil, "linkedin"),
        sessions: [],
    },
    {
        id: "competitorWatch",
        apps: ["composio_search", "notion"],
        lastRunMinutes: 300,
        steps: steps("composio_search", ListChecks, "notion"),
        sessions: [],
    },
    {
        id: "seoContent",
        apps: ["google_search_console", "composio_search", "notion"],
        lastRunMinutes: 2880,
        steps: steps("google_search_console", "composio_search", "notion"),
        sessions: [],
    },
]

export const TICK_MS = 650
const TICKS_PER_RUN = 9
/** Which automation runs next, by index into AUTOMATIONS. */
const RUN_ORDER = [0, 1, 2, 3, 4, 5]
/** A held, finished first run: what reduced motion shows. */
export const STILL_TICK = TICKS_PER_RUN - 1
/** One timeline step's height: its top padding plus the 24px node. */
export const STEP_PX = 38

/** Everything the preview shows at one tick. */
export function frameAt(tick: number) {
    const cycle = Math.floor(tick / TICKS_PER_RUN)
    const phase = tick % TICKS_PER_RUN
    const runningIndex = RUN_ORDER[cycle % RUN_ORDER.length]
    const finished = phase >= 7
    // Steps arrive one at a time, every two ticks from the first.
    const shown = finished ? 3 : Math.max(0, Math.ceil(phase / 2))
    // The clock runs faster than the animation so the run reads as real work.
    const seconds = Math.max(1, Math.round((Math.min(phase, 7) * TICK_MS * 3) / 1000))
    // Cycles since each automation last ran in this preview.
    const ranCyclesAgo = new Map<number, number>()
    // Only the last full rotation matters: an older run was overwritten by a newer one.
    for (let past = Math.max(0, cycle - RUN_ORDER.length); past < cycle; past++) {
        ranCyclesAgo.set(RUN_ORDER[past % RUN_ORDER.length], cycle - past)
    }
    const rows = AUTOMATIONS.map((automation, index) => {
        const cyclesAgo = ranCyclesAgo.get(index)
        const minutes =
            cyclesAgo === undefined
                ? automation.lastRunMinutes
                : Math.max(1, Math.round((cyclesAgo * TICKS_PER_RUN * TICK_MS) / 60_000))
        return {automation, index, lastRunMinutes: minutes}
    })
    return {runningIndex, finished, shown, seconds, rows}
}
