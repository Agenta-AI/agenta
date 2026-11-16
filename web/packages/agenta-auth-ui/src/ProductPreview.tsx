/** A live, decorative mock of the Automations page for the sign-in panel. */
import {useEffect, useState, type ComponentType, type ReactNode} from "react"

import {
    CaretDown,
    CaretUpDown,
    ChatsCircle,
    CircleNotch,
    Compass,
    FileText,
    Gear,
    Globe,
    House,
    Lightning,
    ListChecks,
    NotePencil,
    Plus,
    Robot,
    SidebarSimple,
    SquaresFour,
    Tag,
    type IconProps,
} from "@phosphor-icons/react"
import clsx from "clsx"

import {AgentaWordmark} from "./AgentaBrand"

type Icon = ComponentType<IconProps>
type AppId =
    | "slack"
    | "zendesk"
    | "notion"
    | "hubspot"
    | "gmail"
    | "googlecalendar"
    | "google_search_console"
    | "composio_search"

/** Brand marks from the same logo CDN the Templates page uses. */
const logoUrl = (app: AppId) => `https://logos.composio.dev/api/${app}`

/** One tool call, as the playground's activity timeline shows it. */
interface Step {
    /** A connected app's logo, or the kind glyph for the agent's own tools. */
    icon: AppId | Icon
    running: string
    done: string
}

interface Automation {
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

const AUTOMATIONS: Automation[] = [
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

const TICK_MS = 650
const TICKS_PER_RUN = 9
/** Which automation runs next, by index into AUTOMATIONS. */
const RUN_ORDER = [0, 1, 2, 3, 4, 5]
/** A held, finished first run: what reduced motion shows. */
const STILL_TICK = TICKS_PER_RUN - 1
/** One timeline step's height: its top padding plus the 24px node. */
const STEP_PX = 38

const ago = (minutes: number) =>
    minutes < 60
        ? `${minutes}m ago`
        : minutes < 1440
          ? `${Math.round(minutes / 60)}h ago`
          : `${Math.round(minutes / 1440)}d ago`

/** Everything the preview shows at one tick. */
function frameAt(tick: number) {
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

const usePreviewTick = () => {
    const [tick, setTick] = useState(STILL_TICK)
    useEffect(() => {
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
        if (reduce) return
        setTick(0)
        const interval = setInterval(() => setTick((value) => value + 1), TICK_MS)
        return () => clearInterval(interval)
    }, [])
    return tick
}

/** A brand logo, or the app's initial when the logo CDN is blocked (ad blockers, offline self-hosting). */
const AppLogo = ({app, className}: {app: AppId; className: string}) => {
    const [failed, setFailed] = useState(false)
    if (failed)
        return (
            <span className="auth-preview-muted text-[10px] font-semibold uppercase leading-none">
                {app[0]}
            </span>
        )
    return (
        <img
            src={logoUrl(app)}
            alt=""
            className={`${className} object-contain`}
            onError={() => setFailed(true)}
        />
    )
}

const AppTile = ({app}: {app: AppId}) => (
    <span className="auth-preview-tile inline-flex size-9 flex-none items-center justify-center rounded-[10px]">
        <AppLogo app={app} className="size-[18px]" />
    </span>
)

const NAV: [Icon, string][] = [
    [House, "Home"],
    [Robot, "Agents"],
    [Lightning, "Automations"],
    [Compass, "Skills"],
    [ChatsCircle, "Sessions"],
]

const SESSION_GROUPS = AUTOMATIONS.filter((automation) => automation.sessions.length).slice(0, 3)

const Sidebar = () => (
    <aside className="auth-preview-sidebar flex w-[232px] flex-none flex-col gap-[18px] overflow-hidden px-2.5 pb-3 pt-4">
        <div className="flex items-center justify-between px-1.5">
            <AgentaWordmark className="h-[18px] w-auto" />
            <SidebarSimple size={15} className="auth-preview-muted" />
        </div>
        <nav className="flex flex-col gap-0.5">
            {NAV.map(([NavIcon, label]) => (
                <div
                    key={label}
                    className={clsx(
                        "flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[13px]",
                        label === "Automations" && "auth-preview-nav-active",
                    )}
                >
                    <NavIcon size={16} />
                    <span className="flex-1">{label}</span>
                </div>
            ))}
        </nav>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            {SESSION_GROUPS.map(({name, sessions}) => (
                <div key={name} className="flex flex-col gap-0.5">
                    <div className="auth-preview-faint flex h-[26px] items-center justify-between px-2.5 text-xs">
                        <span className="inline-flex items-center gap-1">
                            {name}
                            <CaretDown size={10} />
                        </span>
                        <Plus size={12} />
                    </div>
                    {sessions.map((session) => (
                        <div
                            key={session}
                            className="flex h-7 items-center gap-2.5 overflow-hidden whitespace-nowrap px-2.5 text-[13px]"
                        >
                            <span className="auth-preview-ring-dot size-1.5 flex-none rounded-full" />
                            <span className="truncate">{session}</span>
                        </div>
                    ))}
                </div>
            ))}
        </div>
        <div className="flex flex-col gap-0.5">
            <div className="flex h-8 items-center gap-2.5 px-2.5 text-[13px]">
                <SquaresFour size={16} />
                <span className="flex-1">Templates</span>
            </div>
            <div className="flex h-8 items-center gap-2.5 px-2.5 text-[13px]">
                <Gear size={16} />
                <span className="flex-1">Settings</span>
            </div>
            <div className="mt-1 flex h-9 items-center gap-2.5 px-1.5 text-[13px]">
                <span className="inline-flex size-6 items-center justify-center rounded-[7px] bg-[#3b82f6] text-xs font-medium text-white">
                    M
                </span>
                <span className="flex-1 truncate">maya@northwind.io</span>
                <CaretUpDown size={12} className="auth-preview-faint" />
            </div>
        </div>
    </aside>
)

/** Live text, as the playground shimmers it. */
const LIVE_TEXT =
    "bg-[linear-gradient(90deg,var(--ag-colorTextQuaternary)_0%,var(--ag-colorText)_50%,var(--ag-colorTextQuaternary)_100%)] bg-clip-text motion-safe:animate-text-shimmer motion-safe:bg-[length:200%_100%] motion-safe:text-transparent"

/** The 24px round node on the timeline wire. */
const StepNode = ({icon, running}: {icon: Step["icon"]; running: boolean}) => {
    let glyph
    if (running) glyph = <CircleNotch size={13} className="motion-safe:animate-spin" />
    else if (typeof icon === "string") {
        glyph = <AppLogo app={icon} className="size-3.5" />
    } else {
        const Glyph = icon
        glyph = <Glyph size={13} />
    }
    return (
        <span className="auth-preview-node auth-preview-faint relative z-10 flex size-6 flex-none items-center justify-center rounded-full">
            {glyph}
        </span>
    )
}

/** Opens its child's height smoothly. */
const Reveal = ({open, children}: {open: boolean; children: ReactNode}) => (
    <div
        className={clsx(
            "grid transition-[grid-template-rows,opacity] duration-[360ms] ease-out",
            open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
    >
        <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
)

/** The run's work, as the playground's activity timeline draws it. */
const Activity = ({
    automation,
    finished,
    shown,
    seconds,
}: {
    automation: Automation
    finished: boolean
    shown: number
    seconds: number
}) => {
    const current = automation.steps[Math.max(0, shown - 1)]
    return (
        <div className="flex flex-col pl-[50px] pt-3">
            <div className="auth-preview-muted flex items-center gap-1.5 text-[13px]">
                <span className={clsx("min-w-0 truncate", !finished && LIVE_TEXT)}>
                    {finished ? `Worked for ${seconds}s` : shown ? current.running : "Starting"}
                </span>
                {finished ? null : (
                    <span className="auth-preview-faint flex-none tabular-nums">· {seconds}s</span>
                )}
                <CaretDown size={10} weight="bold" className="auth-preview-faint flex-none" />
            </div>
            <div className="relative mt-1 flex flex-col">
                {shown > 1 ? (
                    <span
                        aria-hidden
                        className={clsx(
                            "auth-preview-line absolute top-[26px] w-px transition-[height] duration-300",
                            !finished && "ag-activity-wire-live",
                        )}
                        style={{left: 11.5, height: (shown - 1) * STEP_PX}}
                    />
                ) : null}
                {automation.steps.map((step, i) => {
                    const running = !finished && i === shown - 1
                    return (
                        <div
                            key={step.done}
                            className={clsx(
                                "flex min-w-0 items-center gap-3.5 pt-3.5 transition-opacity duration-300",
                                i < shown ? "opacity-100" : "opacity-0",
                            )}
                        >
                            <StepNode icon={step.icon} running={running} />
                            <span className={clsx("truncate text-[13px]", running && LIVE_TEXT)}>
                                {running ? step.running : step.done}
                            </span>
                        </div>
                    )
                })}
            </div>
            <p
                className={clsx(
                    "m-0 pt-3.5 text-[13px] leading-5 transition-opacity duration-300",
                    finished ? "opacity-100" : "opacity-0",
                )}
            >
                {automation.result}.
            </p>
        </div>
    )
}

export const ProductPreview = () => {
    const {runningIndex, finished, shown, seconds, rows} = frameAt(usePreviewTick())

    return (
        <div className="auth-preview flex size-full">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-hidden px-10 pt-10">
                <div className="flex items-end justify-between gap-4">
                    <div className="flex flex-col gap-1.5">
                        <h3 className="m-0 text-[26px] font-semibold leading-8 tracking-[-0.02em]">
                            Automations
                        </h3>
                        <p className="auth-preview-muted m-0 text-sm">
                            Agents that run on a schedule or when something happens in your apps.
                        </p>
                    </div>
                    <span className="auth-preview-cta inline-flex h-8 flex-none items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium">
                        <Plus size={13} />
                        New automation
                    </span>
                </div>
                <div className="flex flex-col gap-2">
                    {rows.map(({automation, index, lastRun}) => {
                        const active = index === runningIndex
                        return (
                            <div
                                key={automation.name}
                                className={clsx(
                                    "auth-preview-row flex flex-col rounded-xl px-4 py-3 transition-shadow duration-300",
                                    active && "auth-preview-open",
                                )}
                            >
                                <div className="flex items-center gap-3.5">
                                    <AppTile app={automation.apps[0]} />
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="truncate text-sm font-medium">
                                            {automation.name}
                                        </span>
                                        <span className="auth-preview-muted flex items-center gap-1.5 text-[13px]">
                                            <span className="truncate">
                                                {active ? automation.event : automation.result}
                                            </span>
                                            <span className="auth-preview-faint flex-none">
                                                · {active ? "now" : lastRun}
                                            </span>
                                        </span>
                                    </div>
                                </div>
                                <Reveal open={active}>
                                    <Activity
                                        automation={automation}
                                        finished={finished}
                                        shown={active ? shown : 3}
                                        seconds={seconds}
                                    />
                                </Reveal>
                            </div>
                        )
                    })}
                </div>
            </div>
        </div>
    )
}
