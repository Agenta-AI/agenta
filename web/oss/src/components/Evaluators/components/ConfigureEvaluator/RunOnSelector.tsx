/**
 * RunOnSelector
 *
 * The "Run on" control for the evaluator playground header. A leading dropdown
 * that names the data source the evaluator runs against and draws the resulting
 * data-flow, so the empty/first state explains itself instead of leaving the
 * user with two disconnected loaders.
 *
 * Three modes:
 *  - Run directly on data  (Data → Evaluator → Score)
 *  - Run on an app         (Data → App → Output → Evaluator → Score) — default
 *  - Run on a trace        (Trace → Evaluator → Score) — disabled for now
 *
 * All colors come from the live antd token (`theme.useToken()`) so the control
 * follows light/dark mode automatically.
 */

import {useState} from "react"

import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {AppstoreOutlined} from "@ant-design/icons"
import {
    CaretDownIcon,
    CheckIcon,
    DatabaseIcon,
    GavelIcon,
    TreeViewIcon,
} from "@phosphor-icons/react"
import {theme} from "antd"
import type {GlobalToken} from "antd"
import clsx from "clsx"

import type {RunOnMode} from "./atoms"

// The app icon used across the product (the sidebar "Prompts" item). Wrapped so
// it accepts the same `size`/`style` props as the phosphor icons it sits beside.
const AppIcon = ({size = 16, style}: {size?: number; style?: React.CSSProperties}) => (
    <AppstoreOutlined style={{fontSize: size, ...style}} />
)

// ── flow pills ──────────────────────────────────────────────────────────────

type FlowVariant = "data" | "app" | "out" | "eval" | "trace"

interface FlowNode {
    label: string
    variant: FlowVariant
}

const flowStyle = (token: GlobalToken, variant: FlowVariant): React.CSSProperties => {
    switch (variant) {
        case "data":
            return {background: token.blue1, color: token.blue7, borderColor: token.blue2}
        case "app":
            return {
                background: token.colorPrimaryBg,
                color: token.colorText,
                borderColor: token.colorPrimaryBorder,
            }
        case "out":
            return {background: token.green1, color: token.green7, borderColor: token.green3}
        case "eval":
            // index 7 (not 6) so the text brightens under the dark algorithm —
            // purple6 lands dark-on-dark and disappears on a dark background.
            return {background: token.purple1, color: token.purple7, borderColor: token.purple3}
        case "trace":
            return {background: token.cyan1, color: token.cyan7, borderColor: token.cyan3}
    }
}

const FlowIcon = ({variant}: {variant: FlowVariant}) => {
    switch (variant) {
        case "data":
            return <DatabaseIcon size={12} />
        case "app":
            return <AppIcon size={12} />
        case "eval":
            return <GavelIcon size={12} />
        case "trace":
            return <TreeViewIcon size={12} />
        default:
            return null
    }
}

const FlowPills = ({steps, token}: {steps: FlowNode[]; token: GlobalToken}) => (
    <div className="flex flex-wrap items-center gap-y-1">
        {steps.map((step, i) => (
            <span key={`${step.label}-${i}`} className="flex items-center">
                {i > 0 && (
                    <span className="px-1.5 text-[12px]" style={{color: token.colorTextQuaternary}}>
                        →
                    </span>
                )}
                <span
                    className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-solid px-2 py-[3px] text-[11px] leading-none"
                    style={flowStyle(token, step.variant)}
                >
                    <FlowIcon variant={step.variant} />
                    {step.label}
                </span>
            </span>
        ))}
    </div>
)

// ── modes ───────────────────────────────────────────────────────────────────

interface ModeDef {
    key: RunOnMode
    /** Full label shown in the dropdown option. */
    label: string
    /** Short label shown after "Run on:" in the trigger button. */
    shortLabel: string
    Icon: React.ComponentType<{size?: number; style?: React.CSSProperties}>
    desc: string
    flow: FlowNode[]
    badge?: "default" | "soon"
    disabled?: boolean
}

const MODES: ModeDef[] = [
    {
        key: "data",
        label: "Run directly on a test case",
        shortLabel: "Test case",
        Icon: DatabaseIcon,
        desc: "Evaluate data you provide. Connect a test set, or type the input and output in by hand.",
        flow: [
            {label: "Data", variant: "data"},
            {label: "Evaluator", variant: "eval"},
            {label: "Score", variant: "out"},
        ],
    },
    {
        key: "app",
        label: "Run on an app output",
        shortLabel: "App output",
        Icon: AppIcon,
        badge: "default",
        desc: "Run an app over your data, then the evaluator grades its output. The usual evaluation flow.",
        flow: [
            {label: "Data", variant: "data"},
            {label: "App", variant: "app"},
            {label: "Output", variant: "out"},
            {label: "Evaluator", variant: "eval"},
            {label: "Score", variant: "out"},
        ],
    },
    {
        key: "trace",
        label: "Run on a trace",
        shortLabel: "Trace",
        Icon: TreeViewIcon,
        badge: "soon",
        disabled: true,
        desc: "Pull the input and output straight from a logged trace in Observability.",
        flow: [
            {label: "Trace", variant: "trace"},
            {label: "Evaluator", variant: "eval"},
            {label: "Score", variant: "out"},
        ],
    },
]

// ── component ───────────────────────────────────────────────────────────────

interface RunOnSelectorProps {
    mode: RunOnMode
    onPick: (mode: RunOnMode) => void
}

const RunOnSelector = ({mode, onPick}: RunOnSelectorProps) => {
    const {token} = theme.useToken()
    const [open, setOpen] = useState(false)
    const [hovered, setHovered] = useState<RunOnMode | null>(null)
    const current = MODES.find((m) => m.key === mode) ?? MODES.find((m) => m.key === "app")!

    const overlay = (
        <div
            className="w-[460px] rounded-lg border border-solid p-1.5"
            style={{
                background: token.colorBgElevated,
                borderColor: token.colorBorderSecondary,
                boxShadow: token.boxShadowSecondary,
            }}
        >
            <div
                className="px-2.5 pb-1.5 pt-1 text-[11px] font-semibold uppercase tracking-[0.04em]"
                style={{color: token.colorTextQuaternary}}
            >
                What should the evaluator run on?
            </div>
            {MODES.map((m) => {
                const selected = m.key === mode
                const isHovered = hovered === m.key
                const background = selected
                    ? token.controlItemBgActive
                    : isHovered && !m.disabled
                      ? token.colorFillTertiary
                      : "transparent"
                return (
                    <div
                        key={m.key}
                        role="button"
                        aria-disabled={m.disabled}
                        onMouseEnter={() => setHovered(m.key)}
                        onMouseLeave={() => setHovered((h) => (h === m.key ? null : h))}
                        onClick={() => {
                            if (m.disabled) return
                            onPick(m.key)
                            setOpen(false)
                        }}
                        className={clsx(
                            "flex items-start gap-3 rounded-md p-2.5",
                            m.disabled ? "cursor-default opacity-55" : "cursor-pointer",
                        )}
                        style={{background}}
                    >
                        <span
                            className="mt-0.5 flex w-[18px] shrink-0 justify-center"
                            style={{color: token.colorPrimary}}
                        >
                            {selected && <CheckIcon size={16} />}
                        </span>
                        <div className="min-w-0 flex-1">
                            <div
                                className="flex items-center gap-2 text-[14px] font-medium"
                                style={{color: token.colorText}}
                            >
                                <m.Icon size={15} />
                                {m.label}
                                {m.badge === "default" && (
                                    <span
                                        className="rounded-full px-[7px] py-px text-[10.5px] font-semibold"
                                        style={{
                                            background: token.colorPrimary,
                                            color: token.colorTextLightSolid,
                                        }}
                                    >
                                        default
                                    </span>
                                )}
                                {m.badge === "soon" && (
                                    <span
                                        className="rounded-full px-[7px] py-px text-[10.5px] font-semibold"
                                        style={{background: token.gold1, color: token.gold8}}
                                    >
                                        soon
                                    </span>
                                )}
                            </div>
                            <div
                                className="mt-0.5 text-[12.5px] leading-snug"
                                style={{color: token.colorTextTertiary}}
                            >
                                {m.desc}
                            </div>
                            <div className="mt-2">
                                <FlowPills steps={m.flow} token={token} />
                            </div>
                        </div>
                    </div>
                )
            })}
        </div>
    )

    return (
        <DropdownMenu open={open} onOpenChange={setOpen}>
            <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                <Button
                    className="flex items-center gap-1.5 font-medium"
                    style={{
                        background: token.colorPrimaryBg,
                        borderColor: token.colorPrimaryBorder,
                    }}
                    variant="outline"
                    size="sm"
                >
                    <span className="font-normal" style={{color: token.colorTextTertiary}}>
                        Run on:
                    </span>
                    <current.Icon size={14} style={{color: token.colorText}} />
                    <span className="truncate">{current.shortLabel}</span>
                    <CaretDownIcon size={12} style={{color: token.colorTextTertiary}} />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="p-0">
                {overlay}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export default RunOnSelector
