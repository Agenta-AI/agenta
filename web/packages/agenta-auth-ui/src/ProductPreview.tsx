/**
 * A live mock of the Automations page for the sign-in panel: one automation runs its steps while
 * the others sit in a grid, then the next one takes over. Decorative and `aria-hidden` by its
 * host; under reduced motion it holds one finished run.
 */
import {useEffect, useState, type ComponentType} from "react"

import {
    At,
    CaretDown,
    CaretUpDown,
    ChatsCircle,
    CheckCircle,
    CircleNotch,
    Clock,
    DiscordLogo,
    EnvelopeSimple,
    Gear,
    GithubLogo,
    GitlabLogo,
    GraduationCap,
    House,
    Lightning,
    MagnifyingGlass,
    NotionLogo,
    Plus,
    Robot,
    SidebarSimple,
    SlackLogo,
    SlidersHorizontal,
    SquaresFour,
    type IconProps,
} from "@phosphor-icons/react"
import clsx from "clsx"

import {AgentaWordmark} from "./AgentaBrand"

type Icon = ComponentType<IconProps>
type AppId = "github" | "gitlab" | "slack" | "notion" | "discord" | "mail"

const APPS: Record<AppId, {Icon: Icon; className: string}> = {
    github: {Icon: GithubLogo, className: "text-[#242424]"},
    gitlab: {Icon: GitlabLogo, className: "text-[#e24329]"},
    slack: {Icon: SlackLogo, className: "text-[#4a154b]"},
    notion: {Icon: NotionLogo, className: "text-[#242424]"},
    discord: {Icon: DiscordLogo, className: "text-[#5865f2]"},
    mail: {Icon: EnvelopeSimple, className: "text-[#d93025]"},
}

interface Automation {
    name: string
    desc: string
    trigger: string
    TriggerIcon: Icon
    apps: AppId[]
    /** Minutes since the last run, before the preview has run it itself. */
    lastRunMinutes: number
    event: string
    steps: [string, string, string]
}

const AUTOMATIONS: Automation[] = [
    {
        name: "Issue triage",
        desc: "Labels new issues and assigns an owner",
        trigger: "Issue opened",
        TriggerIcon: Lightning,
        apps: ["github", "gitlab"],
        lastRunMinutes: 4,
        event: "Issue opened: “Playground hangs on large testsets”",
        steps: [
            "Matched the issue against area labels",
            "Set area:playground and priority:high",
            "Assigned the owner for that area",
        ],
    },
    {
        name: "PR reviewer",
        desc: "Comments inline, flags risky changes",
        trigger: "Pull request opened",
        TriggerIcon: Lightning,
        apps: ["github", "slack"],
        lastRunMinutes: 12,
        event: "PR #482 opened: “Faster trace viewer”",
        steps: [
            "Read the diff across 14 files",
            "Left 3 inline comments",
            "Flagged a risky migration in #eng-review",
        ],
    },
    {
        name: "Changelog writer",
        desc: "Turns merged PRs into release notes",
        trigger: "On release",
        TriggerIcon: Lightning,
        apps: ["github", "notion"],
        lastRunMinutes: 180,
        event: "Release v0.122.3 published",
        steps: [
            "Collected 18 merged PRs",
            "Grouped changes by area",
            "Published release notes to Notion",
        ],
    },
    {
        name: "CI failure triage",
        desc: "Summarizes failed runs, pings the author",
        trigger: "CI run failed",
        TriggerIcon: Lightning,
        apps: ["github", "slack"],
        lastRunMinutes: 38,
        event: "CI failed on main: eval-runner tests",
        steps: ["Read the failing job logs", "Traced it to commit a41f9c2", "Pinged the author in #ci"],
    },
    {
        name: "Dependency digest",
        desc: "Weekly summary of update PRs",
        trigger: "Mondays 09:00",
        TriggerIcon: Clock,
        apps: ["github", "slack"],
        lastRunMinutes: 2880,
        event: "Scheduled run · Monday 09:00",
        steps: ["Found 7 open update PRs", "Ranked them by risk", "Posted the digest to #eng"],
    },
    {
        name: "Code Q&A",
        desc: "Answers repo questions when mentioned",
        trigger: "@agenta in Slack",
        TriggerIcon: At,
        apps: ["slack", "discord"],
        lastRunMinutes: 7,
        event: "@agenta in #eng: “Where is eval scoring defined?”",
        steps: [
            "Searched the repo",
            "Found scoring in evaluators/base.py",
            "Replied in the thread with links",
        ],
    },
]

const TICK_MS = 650
const TICKS_PER_RUN = 9
/** Which automation runs next, by index into AUTOMATIONS. */
const RUN_ORDER = [0, 1, 3, 5, 2, 4]
/** A held, finished first run: what reduced motion shows. */
const STILL_TICK = TICKS_PER_RUN - 1

type StepState = "pending" | "running" | "done"

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
    const featuredIndex = RUN_ORDER[cycle % RUN_ORDER.length]
    const finished = phase >= 7
    const running = phase >= 1 && !finished ? Math.floor((phase - 1) / 2) : -1
    const steps = AUTOMATIONS[featuredIndex].steps.map<[string, StepState]>((text, i) => [
        text,
        finished || i < running ? "done" : i === running ? "running" : "pending",
    ])
    // Cycles since each automation last ran in this preview.
    const ranCyclesAgo = new Map<number, number>()
    for (let past = 0; past < cycle; past++) {
        ranCyclesAgo.set(RUN_ORDER[past % RUN_ORDER.length], cycle - past)
    }
    const cards = AUTOMATIONS.map((automation, index) => ({automation, index}))
        .filter(({index}) => index !== featuredIndex)
        .slice(0, 4)
        .map(({automation, index}) => {
            const cyclesAgo = ranCyclesAgo.get(index)
            const minutes =
                cyclesAgo === undefined
                    ? automation.lastRunMinutes
                    : Math.max(1, Math.round((cyclesAgo * TICKS_PER_RUN * TICK_MS) / 60_000))
            return {automation, lastRun: ago(minutes)}
        })
    return {featured: AUTOMATIONS[featuredIndex], cycle, finished, steps, cards}
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

const AppStack = ({apps}: {apps: AppId[]}) => (
    <div className="flex flex-none">
        {apps.map((id) => {
            const {Icon, className} = APPS[id]
            return (
                <span key={id} className="auth-preview-app -mr-1.5">
                    <Icon size={15} weight={id === "mail" ? "regular" : "fill"} className={className} />
                </span>
            )
        })}
    </div>
)

const NAV: [Icon, string][] = [
    [House, "Home"],
    [Robot, "Agents"],
    [Lightning, "Automations"],
    [GraduationCap, "Skills"],
    [ChatsCircle, "Sessions"],
]

const SESSION_GROUPS: [string, string[]][] = [
    ["Issue triage", ["Playground hangs on large testsets", "Weekly triage summary"]],
    ["PR reviewer", ["Review #482 · trace viewer", "Review #479 · eval runner"]],
    ["Changelog writer", ["Release notes v0.122"]],
]

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
                    {label === "Sessions" ? (
                        <span className="auth-preview-faint flex gap-2">
                            <MagnifyingGlass size={13} />
                            <SlidersHorizontal size={13} />
                        </span>
                    ) : null}
                </div>
            ))}
        </nav>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            {SESSION_GROUPS.map(([group, sessions]) => (
                <div key={group} className="flex flex-col gap-0.5">
                    <div className="auth-preview-faint flex h-[26px] items-center justify-between px-2.5 text-xs">
                        <span className="inline-flex items-center gap-1">
                            {group}
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
                <span className="auth-preview-faint text-[11px]">v0.122.3</span>
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

const StepIcon = ({state}: {state: StepState}) =>
    state === "done" ? (
        <CheckCircle size={16} weight="fill" className="auth-preview-success auth-preview-check" />
    ) : state === "running" ? (
        <CircleNotch size={15} className="motion-safe:animate-spin" />
    ) : (
        <span className="auth-preview-pending size-3 rounded-full" />
    )

export const ProductPreview = () => {
    const {featured, cycle, finished, steps, cards} = frameAt(usePreviewTick())

    return (
        <div className="auth-preview flex size-full">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col gap-[22px] overflow-hidden px-10 pt-10">
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

                <div className="auth-preview-feature grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] overflow-hidden rounded-[14px]">
                    <div className="flex flex-col gap-3.5 p-[22px]">
                        <span className="auth-preview-muted inline-flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.04em]">
                            <span
                                className={clsx(
                                    "size-1.5 rounded-full",
                                    finished
                                        ? "auth-preview-success-bg"
                                        : "auth-preview-running-bg motion-safe:animate-pulse",
                                )}
                            />
                            {finished ? "Completed just now" : "Running now"}
                        </span>
                        <div key={cycle} className="auth-preview-enter flex flex-col gap-3">
                            <AppStack apps={featured.apps} />
                            <div className="flex flex-col gap-1.5">
                                <span className="text-xl font-semibold leading-[26px] tracking-[-0.01em]">
                                    {featured.name}
                                </span>
                                <span className="auth-preview-muted text-[13px] leading-5">
                                    {featured.desc}
                                </span>
                            </div>
                            <span className="auth-preview-tag inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-[3px] text-xs">
                                <featured.TriggerIcon size={12} />
                                {featured.trigger}
                            </span>
                        </div>
                    </div>
                    <div className="auth-preview-card my-3 mr-3 flex flex-col gap-3 rounded-[10px] p-[18px]">
                        <span className="auth-preview-faint text-[11px] font-medium uppercase tracking-[0.04em]">
                            Live run
                        </span>
                        <span className="text-[13px] font-medium leading-5">{featured.event}</span>
                        <div className="flex flex-col gap-2.5">
                            {steps.map(([text, state]) => (
                                <div
                                    key={text}
                                    className={clsx(
                                        "flex items-start gap-2.5 text-[13px] leading-[18px] transition-colors duration-300",
                                        state === "pending" && "auth-preview-faint",
                                    )}
                                >
                                    <span className="mt-px inline-flex size-4 flex-none items-center justify-center">
                                        <StepIcon state={state} />
                                    </span>
                                    <span>{text}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                    {cards.map(({automation, lastRun}) => (
                        <div
                            key={automation.name}
                            className="auth-preview-card flex flex-col gap-3 rounded-xl px-[18px] pb-3.5 pt-[18px]"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <AppStack apps={automation.apps} />
                                <span className="auth-preview-muted inline-flex items-center gap-1.5 text-[11px]">
                                    <span className="auth-preview-success-bg size-1.5 rounded-full" />
                                    Active
                                </span>
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-[15px] font-semibold leading-5">
                                    {automation.name}
                                </span>
                                <span className="auth-preview-muted line-clamp-2 text-[13px] leading-[19px]">
                                    {automation.desc}
                                </span>
                            </div>
                            <div className="auth-preview-faint auth-preview-divider flex items-center justify-between gap-2 whitespace-nowrap pt-3 text-xs">
                                <span className="inline-flex min-w-0 items-center gap-1.5 overflow-hidden">
                                    <automation.TriggerIcon size={13} className="flex-none" />
                                    <span className="truncate">{automation.trigger}</span>
                                </span>
                                <span className="tabular-nums">{lastRun}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
