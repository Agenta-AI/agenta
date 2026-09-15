import type {ComponentType} from "react"

import {IntegrationTile} from "@agenta/entity-ui/clientTools"
import {
    Brain,
    Browser,
    ChartLine,
    CheckCircle,
    CircleNotch,
    Clock,
    ClockCountdown,
    Cube,
    DotsThree,
    FileText,
    FolderOpen,
    GitCommit,
    Globe,
    Info,
    Lightning,
    ListChecks,
    MagicWand,
    MagnifyingGlass,
    Note,
    NotePencil,
    Package,
    PencilSimple,
    PlayCircle,
    Plug,
    Plugs,
    PlugsConnected,
    Prohibit,
    Question,
    SealQuestion,
    ShieldCheck,
    SlidersHorizontal,
    TerminalWindow,
    TreeStructure,
    type IconProps,
} from "@phosphor-icons/react"

import type {ActivityIcon} from "../../skin/types"

type Icon = ComponentType<IconProps>

/** The activity icon spec, one glyph per token. Phosphor regular, 13px in a 24px node. */
const KIND_GLYPHS: Record<ActivityIcon, Icon> = {
    brain: Brain,
    terminal: TerminalWindow,
    "file-read": FileText,
    "file-write": NotePencil,
    "file-list": FolderOpen,
    "file-search": MagnifyingGlass,
    "web-search": Globe,
    "web-fetch": Browser,
    subtask: TreeStructure,
    "task-list": ListChecks,
    commit: GitCommit,
    config: SlidersHorizontal,
    rename: PencilSimple,
    test: PlayCircle,
    schedule: Clock,
    trigger: Lightning,
    runs: ChartLine,
    annotation: Note,
    deliveries: Package,
    "tool-search": MagicWand,
    connections: Plugs,
    gateway: Plugs,
    mcp: Plug,
    platform: Cube,
    ask: Question,
    connect: PlugsConnected,
}

/**
 * The step's own state, layered over its kind. State REPLACES the kind glyph — a running step
 * shows the spinner and takes its glyph back when it settles; a gate shows where it stands.
 */
export type ActivityState =
    | "idle"
    | "queued"
    | "running"
    | "awaiting"
    | "approved"
    | "denied"
    | "responded"
    | "deferred"
    | "not-handled"

const STATE_GLYPHS: Record<Exclude<ActivityState, "idle">, Icon> = {
    queued: DotsThree,
    running: CircleNotch,
    awaiting: ShieldCheck,
    approved: CheckCircle,
    denied: Prohibit,
    responded: SealQuestion,
    deferred: ClockCountdown,
    "not-handled": Info,
}

/** Colour carries two meanings only: warning = your turn, disabled = never ran. */
const NODE_TONE: Partial<Record<ActivityState, string>> = {
    awaiting: "border-colorWarning/40 text-colorWarning",
    deferred: "text-colorTextDisabled",
    "not-handled": "text-colorTextDisabled",
}

/** Live text — the collapsed line's verb, the step in flight — with a light sweeping through the
 * words. The gradient is periodic (quaternary at both ends, the light in the middle) and one
 * cycle of `text-shimmer` moves it exactly one tile, so the loop never blinks. `motion-safe`:
 * reduced motion reads it as plain text. */
export const LIVE_TEXT_CLASS =
    "bg-[linear-gradient(90deg,var(--ag-colorTextQuaternary)_0%,var(--ag-colorText)_50%,var(--ag-colorTextQuaternary)_100%)] bg-clip-text motion-safe:animate-text-shimmer motion-safe:bg-[length:200%_100%] motion-safe:text-transparent"

export interface ActivityNodeProps {
    icon: ActivityIcon
    state?: ActivityState
    /** A connected app's own mark. It IS the icon: no kind glyph beside it. */
    logo?: string | null
    /** The app's name, for the logo's initials fallback. */
    appLabel?: string
    /** The kind glyph reads as warning while the run waits on the reader. */
    yourTurn?: boolean
}

/** The 24px round node on the timeline wire. */
export const ActivityNode = ({
    icon,
    state = "idle",
    logo,
    appLabel,
    yourTurn,
}: ActivityNodeProps) => {
    const tone = NODE_TONE[state] ?? (yourTurn ? NODE_TONE.awaiting : "text-colorTextTertiary")
    const stateGlyph = state === "idle" ? null : STATE_GLYPHS[state]
    const Glyph = stateGlyph ?? KIND_GLYPHS[icon]
    const showLogo = !stateGlyph && !!logo
    return (
        <span
            aria-hidden
            className={`relative z-10 flex size-6 shrink-0 items-center justify-center rounded-full border border-colorBorderSecondary bg-colorBgContainer ${tone}`}
        >
            {showLogo ? (
                <IntegrationTile label={appLabel ?? ""} logo={logo} size={16} />
            ) : (
                <Glyph
                    size={13}
                    className={state === "running" ? "motion-safe:animate-spin" : undefined}
                />
            )}
        </span>
    )
}

/** What the run is parked on: an approval, or one of the asks a client tool makes. */
export type WaitingKind = "approval" | ActivityIcon

/** The node slot beside the collapsed line while the run is parked on the reader, wearing the
 * glyph of whatever it waits for — the same one its step shows. */
export const WaitingGlyph = ({kind = "approval"}: {kind?: WaitingKind}) => {
    const Glyph = kind === "approval" ? ShieldCheck : KIND_GLYPHS[kind]
    return (
        <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center text-colorWarning"
        >
            <Glyph size={13} />
        </span>
    )
}
