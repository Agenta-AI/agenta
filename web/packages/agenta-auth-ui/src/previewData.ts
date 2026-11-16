/** The demo content of the sign-in preview: six automation templates and the run loop's clock. */
import type {ComponentType} from "react"

import {FileText, Globe, ListChecks, NotePencil, Tag, type IconProps} from "@phosphor-icons/react"

export type Icon = ComponentType<IconProps>
export type AppId =
    | "slack"
    | "zendesk"
    | "notion"
    | "hubspot"
    | "gmail"
    | "googlecalendar"
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
        name: "Support reply drafter",
        apps: ["zendesk", "notion"],
        lastRunMinutes: 9,
        event: "New ticket: “How do I export my data?”",
        steps: [
            {icon: "zendesk", running: "Reading the ticket", done: "Read ticket #4821"},
            {
                icon: "notion",
                running: "Searching your docs",
                done: "Found the export guide in Notion",
            },
            {icon: NotePencil, running: "Drafting a reply", done: "Drafted a reply for review"},
        ],
        result: "Reply draft ready for review",
        sessions: ["How do I export my data?", "Change billing email"],
    },
    {
        name: "Lead qualifier",
        apps: ["hubspot", "gmail"],
        lastRunMinutes: 12,
        event: "New lead: Dana Ortiz, Brightline Clinics",
        steps: [
            {
                icon: Globe,
                running: "Researching the company",
                done: "Researched Brightline Clinics",
            },
            {icon: ListChecks, running: "Scoring the lead", done: "Scored the lead 82 of 100"},
            {
                icon: "hubspot",
                running: "Updating HubSpot",
                done: "Marked the lead qualified in HubSpot",
            },
        ],
        result: "Qualified with a score of 82",
        sessions: ["Brightline Clinics"],
    },
    {
        name: "CRM updater",
        apps: ["gmail", "hubspot"],
        lastRunMinutes: 180,
        event: "Daily run over 24 new email threads",
        steps: [
            {icon: "gmail", running: "Reading email threads", done: "Read 24 new email threads"},
            {icon: FileText, running: "Matching contacts", done: "Matched 9 threads to open deals"},
            {icon: "hubspot", running: "Updating records", done: "Updated 9 deals in HubSpot"},
        ],
        result: "9 deals updated",
        sessions: [],
    },
    {
        name: "Meeting follow-up",
        apps: ["gmail", "googlecalendar", "hubspot"],
        lastRunMinutes: 38,
        event: "Meeting ended: Demo with Harbor & Co.",
        steps: [
            {
                icon: "googlecalendar",
                running: "Reading the meeting",
                done: "Read the notes from the demo",
            },
            {icon: "gmail", running: "Drafting the follow-up", done: "Drafted the follow-up email"},
            {icon: "hubspot", running: "Logging notes", done: "Logged the notes in HubSpot"},
        ],
        result: "Follow-up email ready to send",
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
