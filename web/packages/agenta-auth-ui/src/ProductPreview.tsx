/** A live, decorative mock of the Automations page for the sign-in panel. */
import {useEffect, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import previewDemoCatalog from "@agenta/i18n/catalogs/auth.previewDemo"
import previewCatalog from "@agenta/i18n/catalogs/auth.productPreview"
import {
    CaretDown,
    CaretUpDown,
    ChatsCircle,
    CircleNotch,
    Compass,
    Gear,
    House,
    Lightning,
    Plus,
    Robot,
    SidebarSimple,
    SquaresFour,
} from "@phosphor-icons/react"
import clsx from "clsx"

import {AgentaWordmark} from "./AgentaBrand"
import {
    AUTOMATIONS,
    STEP_PX,
    STILL_TICK,
    TICK_MS,
    frameAt,
    logoUrl,
    type AppId,
    type Automation,
    type Icon,
    type Step,
} from "./previewData"

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

type NavId = "Home" | "Agents" | "Automations" | "Skills" | "Sessions"

const NAV: [Icon, NavId][] = [
    [House, "Home"],
    [Robot, "Agents"],
    [Lightning, "Automations"],
    [Compass, "Skills"],
    [ChatsCircle, "Sessions"],
]

const SESSION_GROUPS = AUTOMATIONS.filter((automation) => automation.sessions.length).slice(0, 3)

const Sidebar = () => {
    const t = useT(previewCatalog, previewDemoCatalog)
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
                    </div>
                ))}
            </nav>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
                {SESSION_GROUPS.map(({id, sessions}) => (
                    <div key={id} className="flex flex-col gap-0.5">
                        <div className="auth-preview-faint flex h-[26px] items-center justify-between px-2.5 text-xs">
                            <span className="inline-flex items-center gap-1">
                                {t(`auth.previewDemo.${id}Name`)}
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
                                <span className="truncate">{t(`auth.previewDemo.${session}`)}</span>
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
    const t = useT(previewCatalog, previewDemoCatalog)
    const {id} = automation
    const current = automation.steps[Math.max(0, shown - 1)]
    return (
        <div className="flex flex-col pl-[50px] pt-3">
            <div className="auth-preview-muted flex items-center gap-1.5 text-[13px]">
                <span className={clsx("min-w-0 truncate", !finished && LIVE_TEXT)}>
                    {finished
                        ? t("auth.productPreview.workedFor", {seconds})
                        : shown
                          ? t(`auth.previewDemo.${id}Step${current.n}Running`)
                          : t("auth.productPreview.starting")}
                </span>
                {finished ? null : (
                    <span className="auth-preview-faint flex-none tabular-nums">
                        · {t("auth.productPreview.elapsed", {seconds})}
                    </span>
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
                            key={step.n}
                            className={clsx(
                                "flex min-w-0 items-center gap-3.5 pt-3.5 transition-opacity duration-300",
                                i < shown ? "opacity-100" : "opacity-0",
                            )}
                        >
                            <StepNode icon={step.icon} running={running} />
                            <span className={clsx("truncate text-[13px]", running && LIVE_TEXT)}>
                                {running
                                    ? t(`auth.previewDemo.${id}Step${step.n}Running`)
                                    : t(`auth.previewDemo.${id}Step${step.n}Done`)}
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
                {t("auth.previewDemo.sentence", {text: t(`auth.previewDemo.${id}Result`)})}
            </p>
        </div>
    )
}

export const ProductPreview = () => {
    const t = useT(previewCatalog, previewDemoCatalog)
    const {runningIndex, finished, shown, seconds, rows} = frameAt(usePreviewTick())
    const ago = (minutes: number) =>
        minutes < 60
            ? t("auth.productPreview.minutesAgo", {count: minutes})
            : minutes < 1440
              ? t("auth.productPreview.hoursAgo", {count: Math.round(minutes / 60)})
              : t("auth.productPreview.daysAgo", {count: Math.round(minutes / 1440)})

    return (
        <div className="auth-preview flex size-full">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col gap-6 overflow-hidden px-10 pt-10">
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
                <div className="flex flex-col gap-2">
                    {rows.map(({automation, index, lastRunMinutes}) => {
                        const active = index === runningIndex
                        return (
                            <div
                                key={automation.id}
                                className={clsx(
                                    "auth-preview-row flex flex-col rounded-xl px-4 py-3 transition-shadow duration-300",
                                    active && "auth-preview-open",
                                )}
                            >
                                <div className="flex items-center gap-3.5">
                                    <AppTile app={automation.apps[0]} />
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <span className="truncate text-sm font-medium">
                                            {t(`auth.previewDemo.${automation.id}Name`)}
                                        </span>
                                        <span className="auth-preview-muted flex items-center gap-1.5 text-[13px]">
                                            <span className="truncate">
                                                {active
                                                    ? t(`auth.previewDemo.${automation.id}Event`)
                                                    : t(`auth.previewDemo.${automation.id}Result`)}
                                            </span>
                                            <span className="auth-preview-faint flex-none">
                                                ·{" "}
                                                {active
                                                    ? t("auth.productPreview.now")
                                                    : ago(lastRunMinutes)}
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
