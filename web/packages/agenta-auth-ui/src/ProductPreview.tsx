/** A live, decorative mock of the Automations page for the sign-in panel. */
import {useEffect, useState, type ComponentType} from "react"

import {useT} from "@agenta/i18n"
import previewCatalog from "@agenta/i18n/catalogs/auth.productPreview"
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

type AutomationId =
    | "issueTriage"
    | "prReviewer"
    | "changelogWriter"
    | "ciFailureTriage"
    | "dependencyDigest"
    | "codeQa"

interface Automation {
    id: AutomationId
    TriggerIcon: Icon
    apps: AppId[]
    /** Minutes since the last run, before the preview has run it itself. */
    lastRunMinutes: number
}

const AUTOMATIONS: Automation[] = [
    {id: "issueTriage", TriggerIcon: Lightning, apps: ["github", "gitlab"], lastRunMinutes: 4},
    {id: "prReviewer", TriggerIcon: Lightning, apps: ["github", "slack"], lastRunMinutes: 12},
    {
        id: "changelogWriter",
        TriggerIcon: Lightning,
        apps: ["github", "notion"],
        lastRunMinutes: 180,
    },
    {id: "ciFailureTriage", TriggerIcon: Lightning, apps: ["github", "slack"], lastRunMinutes: 38},
    {id: "dependencyDigest", TriggerIcon: Clock, apps: ["github", "slack"], lastRunMinutes: 2880},
    {id: "codeQa", TriggerIcon: At, apps: ["slack", "discord"], lastRunMinutes: 7},
]

const TICK_MS = 650
const TICKS_PER_RUN = 9
/** Which automation runs next, by index into AUTOMATIONS. */
const RUN_ORDER = [0, 1, 3, 5, 2, 4]
/** A held, finished first run: what reduced motion shows. */
const STILL_TICK = TICKS_PER_RUN - 1

type StepState = "pending" | "running" | "done"
type StepNumber = 1 | 2 | 3
const STEP_NUMBERS: StepNumber[] = [1, 2, 3]

type Translate = ReturnType<typeof useT<[typeof previewCatalog]>>

const ago = (t: Translate, minutes: number) =>
    minutes < 60
        ? t("auth.productPreview.minutesAgo", {count: minutes})
        : minutes < 1440
          ? t("auth.productPreview.hoursAgo", {count: Math.round(minutes / 60)})
          : t("auth.productPreview.daysAgo", {count: Math.round(minutes / 1440)})

/** Everything the preview shows at one tick. */
function frameAt(tick: number) {
    const cycle = Math.floor(tick / TICKS_PER_RUN)
    const phase = tick % TICKS_PER_RUN
    const featuredIndex = RUN_ORDER[cycle % RUN_ORDER.length]
    const finished = phase >= 7
    const running = phase >= 1 && !finished ? Math.floor((phase - 1) / 2) : -1
    const steps = STEP_NUMBERS.map<[StepNumber, StepState]>((number, i) => [
        number,
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
            return {automation, minutes}
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
                    <Icon
                        size={15}
                        weight={id === "mail" ? "regular" : "fill"}
                        className={className}
                    />
                </span>
            )
        })}
    </div>
)

type NavId = "Home" | "Agents" | "Automations" | "Skills" | "Sessions"

const NAV: [Icon, NavId][] = [
    [House, "Home"],
    [Robot, "Agents"],
    [Lightning, "Automations"],
    [GraduationCap, "Skills"],
    [ChatsCircle, "Sessions"],
]

type SessionGroupId = "groupIssueTriage" | "groupPrReviewer" | "groupChangelogWriter"
type SessionId =
    | "sessionPlaygroundHangs"
    | "sessionWeeklyTriage"
    | "sessionReviewTraceViewer"
    | "sessionReviewEvalRunner"
    | "sessionReleaseNotes"

const SESSION_GROUPS: [SessionGroupId, SessionId[]][] = [
    ["groupIssueTriage", ["sessionPlaygroundHangs", "sessionWeeklyTriage"]],
    ["groupPrReviewer", ["sessionReviewTraceViewer", "sessionReviewEvalRunner"]],
    ["groupChangelogWriter", ["sessionReleaseNotes"]],
]

const Sidebar = () => {
    const t = useT(previewCatalog)
    return (
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
                        <span className="flex-1">{t(`auth.productPreview.nav${label}`)}</span>
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
                                {t(`auth.productPreview.${group}`)}
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
                                <span className="truncate">
                                    {t(`auth.productPreview.${session}`)}
                                </span>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
            <div className="flex flex-col gap-0.5">
                <div className="flex h-8 items-center gap-2.5 px-2.5 text-[13px]">
                    <SquaresFour size={16} />
                    <span className="flex-1">{t("auth.productPreview.navTemplates")}</span>
                </div>
                <div className="flex h-8 items-center gap-2.5 px-2.5 text-[13px]">
                    <Gear size={16} />
                    <span className="flex-1">{t("auth.productPreview.navSettings")}</span>
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
}

const StepIcon = ({state}: {state: StepState}) =>
    state === "done" ? (
        <CheckCircle size={16} weight="fill" className="auth-preview-success auth-preview-check" />
    ) : state === "running" ? (
        <CircleNotch size={15} className="motion-safe:animate-spin" />
    ) : (
        <span className="auth-preview-pending size-3 rounded-full" />
    )

export const ProductPreview = () => {
    const t = useT(previewCatalog)
    const {featured, cycle, finished, steps, cards} = frameAt(usePreviewTick())

    return (
        <div className="auth-preview flex size-full">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col gap-[22px] overflow-hidden px-10 pt-10">
                <div className="flex items-end justify-between gap-4">
                    <div className="flex flex-col gap-1.5">
                        <h3 className="m-0 text-[26px] font-semibold leading-8 tracking-[-0.02em]">
                            {t("auth.productPreview.title")}
                        </h3>
                        <p className="auth-preview-muted m-0 text-sm">
                            {t("auth.productPreview.subtitle")}
                        </p>
                    </div>
                    <span className="auth-preview-cta inline-flex h-8 flex-none items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium">
                        <Plus size={13} />
                        {t("auth.productPreview.newAutomation")}
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
                            {finished
                                ? t("auth.productPreview.completedJustNow")
                                : t("auth.productPreview.runningNow")}
                        </span>
                        <div key={cycle} className="auth-preview-enter flex flex-col gap-3">
                            <AppStack apps={featured.apps} />
                            <div className="flex flex-col gap-1.5">
                                <span className="text-xl font-semibold leading-[26px] tracking-[-0.01em]">
                                    {t(`auth.productPreview.${featured.id}Name`)}
                                </span>
                                <span className="auth-preview-muted text-[13px] leading-5">
                                    {t(`auth.productPreview.${featured.id}Desc`)}
                                </span>
                            </div>
                            <span className="auth-preview-tag inline-flex items-center gap-1.5 self-start rounded-full px-2.5 py-[3px] text-xs">
                                <featured.TriggerIcon size={12} />
                                {t(`auth.productPreview.${featured.id}Trigger`)}
                            </span>
                        </div>
                    </div>
                    <div className="auth-preview-card my-3 mr-3 flex flex-col gap-3 rounded-[10px] p-[18px]">
                        <span className="auth-preview-faint text-[11px] font-medium uppercase tracking-[0.04em]">
                            {t("auth.productPreview.liveRun")}
                        </span>
                        <span className="text-[13px] font-medium leading-5">
                            {t(`auth.productPreview.${featured.id}Event`)}
                        </span>
                        <div className="flex flex-col gap-2.5">
                            {steps.map(([number, state]) => (
                                <div
                                    key={number}
                                    className={clsx(
                                        "flex items-start gap-2.5 text-[13px] leading-[18px] transition-colors duration-300",
                                        state === "pending" && "auth-preview-faint",
                                    )}
                                >
                                    <span className="mt-px inline-flex size-4 flex-none items-center justify-center">
                                        <StepIcon state={state} />
                                    </span>
                                    <span>
                                        {t(`auth.productPreview.${featured.id}Step${number}`)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3.5">
                    {cards.map(({automation, minutes}) => (
                        <div
                            key={automation.id}
                            className="auth-preview-card flex flex-col gap-3 rounded-xl px-[18px] pb-3.5 pt-[18px]"
                        >
                            <div className="flex items-start justify-between gap-2">
                                <AppStack apps={automation.apps} />
                                <span className="auth-preview-muted inline-flex items-center gap-1.5 text-[11px]">
                                    <span className="auth-preview-success-bg size-1.5 rounded-full" />
                                    {t("auth.productPreview.active")}
                                </span>
                            </div>
                            <div className="flex flex-col gap-1">
                                <span className="text-[15px] font-semibold leading-5">
                                    {t(`auth.productPreview.${automation.id}Name`)}
                                </span>
                                <span className="auth-preview-muted line-clamp-2 text-[13px] leading-[19px]">
                                    {t(`auth.productPreview.${automation.id}Desc`)}
                                </span>
                            </div>
                            <div className="auth-preview-faint auth-preview-divider flex items-center justify-between gap-2 whitespace-nowrap pt-3 text-xs">
                                <span className="inline-flex min-w-0 items-center gap-1.5 overflow-hidden">
                                    <automation.TriggerIcon size={13} className="flex-none" />
                                    <span className="truncate">
                                        {t(`auth.productPreview.${automation.id}Trigger`)}
                                    </span>
                                </span>
                                <span className="tabular-nums">{ago(t, minutes)}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    )
}
