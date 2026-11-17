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

/** One tool call, as the playground's activity timeline shows it. */
export interface Step {
    /** A connected app's logo, or the kind glyph for the agent's own tools. */
    icon: AppId | Icon
    running: string
    done: string
}

export interface Automation {
    name: string
    apps: AppId[]
    /** Minutes since the last run, before the preview has run it itself. */
    lastRunMinutes: number
    event: string
    steps: [Step, Step, Step]
    /** What the run leaves behind for the person. */
    result: string
    /** Past runs, shown as sessions in the sidebar. */
    sessions: string[]
}

export const AUTOMATIONS: Automation[] = [
    {
        name: "Support triage",
        apps: ["slack"],
        lastRunMinutes: 4,
        event: "New message in #support",
        steps: [
            {icon: "slack", running: "Reading #support", done: "Read a new message in #support"},
            {icon: Tag, running: "Tagging urgency", done: "Tagged it billing, high urgency"},
            {icon: "slack", running: "Routing to an owner", done: "Routed it to the billing owner"},
        ],
        result: "Routed to billing as high urgency",
        sessions: ["Refund not received", "Login loop on mobile"],
    },
    {
        name: "Client report agent",
        apps: ["google_analytics", "googleads", "gmail"],
        lastRunMinutes: 9,
        event: "Weekly report for Northwind Dental",
        steps: [
            {
                icon: "google_analytics",
                running: "Reading site traffic",
                done: "Pulled 12.4K visits, up 8%",
            },
            {
                icon: "googleads",
                running: "Reading ad results",
                done: "Pulled 64 leads at $31 each",
            },
            {icon: "gmail", running: "Emailing the client", done: "Sent the report to the client"},
        ],
        result: "Report sent to Northwind Dental",
        sessions: ["Northwind Dental", "Harbor & Co."],
    },
    {
        name: "Ad spend watcher",
        apps: ["googleads", "facebook", "slack"],
        lastRunMinutes: 22,
        event: "Hourly check over 14 campaigns",
        steps: [
            {icon: "facebook", running: "Checking Meta Ads", done: "Checked 9 Meta campaigns"},
            {
                icon: "googleads",
                running: "Checking Google Ads",
                done: "Found one campaign 40% over budget",
            },
            {icon: "slack", running: "Alerting the team", done: "Flagged it in #client-ads"},
        ],
        result: "1 campaign flagged in #client-ads",
        sessions: ["Spring promo overspend"],
    },
    {
        name: "Social post agent",
        apps: ["linkedin", "twitter", "notion"],
        lastRunMinutes: 95,
        event: "New blog post: “5 intake form mistakes”",
        steps: [
            {icon: "notion", running: "Reading the post", done: "Read the new post in Notion"},
            {
                icon: NotePencil,
                running: "Writing the posts",
                done: "Wrote a LinkedIn post and an X thread",
            },
            {icon: "linkedin", running: "Scheduling", done: "Scheduled both for Tuesday 9:00"},
        ],
        result: "2 posts scheduled for Tuesday",
        sessions: [],
    },
    {
        name: "Competitor watch",
        apps: ["composio_search", "notion"],
        lastRunMinutes: 300,
        event: "Weekly check on 4 competitors",
        steps: [
            {
                icon: "composio_search",
                running: "Scanning competitor sites",
                done: "Found 3 new pages and 2 new ads",
            },
            {
                icon: ListChecks,
                running: "Comparing with last week",
                done: "Spotted a new pricing page",
            },
            {icon: "notion", running: "Writing the digest", done: "Saved the digest to Notion"},
        ],
        result: "Digest saved: 1 pricing change",
        sessions: [],
    },
    {
        name: "SEO content agent",
        apps: ["google_search_console", "composio_search", "notion"],
        lastRunMinutes: 2880,
        event: "On demand: “patient intake forms”",
        steps: [
            {
                icon: "google_search_console",
                running: "Checking Search Console",
                done: "Found 6 queries with room to grow",
            },
            {
                icon: "composio_search",
                running: "Researching the topic",
                done: "Read the top 10 results",
            },
            {
                icon: "notion",
                running: "Writing the brief",
                done: "Saved the approved brief to Notion",
            },
        ],
        result: "Brief approved, draft in progress",
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

const ago = (minutes: number) =>
    minutes < 60
        ? `${minutes}m ago`
        : minutes < 1440
          ? `${Math.round(minutes / 60)}h ago`
          : `${Math.round(minutes / 1440)}d ago`

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
        return {automation, index, lastRun: ago(minutes)}
    })
    return {runningIndex, finished, shown, seconds, rows}
}
