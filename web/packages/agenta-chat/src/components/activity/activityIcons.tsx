import type {ComponentType, ReactNode} from "react"

import {IntegrationTile} from "@agenta/entity-ui/clientTools"
import {
    Brain,
    Browser,
    CaretDown,
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
    Key,
    PlugsConnected,
    Prohibit,
    Question,
    SealQuestion,
    ShieldCheck,
    SlidersHorizontal,
    TerminalWindow,
    TreeStructure,
    WarningCircle,
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
    secret: Key,
}

/** The step's own state; it replaces the kind glyph until the step settles. */
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
    | "failed"

const STATE_GLYPHS: Record<Exclude<ActivityState, "idle">, Icon> = {
    queued: DotsThree,
    running: CircleNotch,
    awaiting: ShieldCheck,
    approved: CheckCircle,
    denied: Prohibit,
    responded: SealQuestion,
    deferred: ClockCountdown,
    "not-handled": Info,
    failed: WarningCircle,
}

/** Colour carries three meanings: warning = your turn, disabled = never ran, error = the run stopped. */
const NODE_TONE: Partial<Record<ActivityState, string>> = {
    awaiting: "border-colorWarning/40 text-colorWarning",
    deferred: "text-colorTextDisabled",
    "not-handled": "text-colorTextDisabled",
    failed: "border-colorError/40 text-colorError",
}

/** Live text: a periodic gradient one `text-shimmer` cycle moves exactly one tile, so the loop never blinks. */
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

/** One step's row: the node, the sentence, a caret; the `after` box is the ~44px touch target. */
export const StepRow = ({
    open,
    onToggle,
    controls,
    children,
}: {
    /** Expanded state; undefined for a row with nothing to open. */
    open?: boolean
    onToggle?: () => void
    /** The id of the panel `open` reveals. */
    controls?: string
    children: ReactNode
}) =>
    onToggle ? (
        <button
            type="button"
            onClick={onToggle}
            aria-expanded={open}
            aria-controls={open === undefined ? undefined : controls}
            className="relative -ml-1.5 flex w-fit max-w-full min-w-0 cursor-pointer items-center gap-3.5 rounded-md border-0 bg-transparent px-1.5 py-0.5 text-left group/row after:absolute after:-inset-y-2 after:inset-x-0 after:content-['']"
        >
            {children}
        </button>
    ) : (
        <div className="flex min-w-0 items-center gap-3.5 py-0.5">{children}</div>
    )

/** The caret at the end of an expandable row. */
export const StepCaret = ({open}: {open: boolean}) => (
    <CaretDown
        size={9}
        weight="bold"
        className={`shrink-0 text-colorTextDisabled opacity-50 transition-transform ${
            open ? "rotate-180" : ""
        }`}
    />
)

/** What the run is parked on: an approval, or one of the asks a client tool makes. */
export type WaitingKind = "approval" | ActivityIcon

/** The node slot beside the collapsed line while parked on the reader, wearing what it waits for. */
export const WaitingGlyph = ({kind = "approval"}: {kind?: WaitingKind}) => {
    const Glyph = kind === "approval" ? ShieldCheck : KIND_GLYPHS[kind]
    return (
        <span
            aria-hidden
            className="flex size-6 shrink-0 items-center justify-center text-colorWarning"
        >
            <Glyph size={16} />
        </span>
    )
}
