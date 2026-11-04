import {useState} from "react"

import {cn} from "@agenta/ui/styles"
import {
    Badge,
    type BadgeProps,
    Button,
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@agenta/ui/ui"
import {
    AppWindow,
    CaretDown,
    Check,
    Database,
    Gavel,
    TreeView,
    type Icon,
} from "@phosphor-icons/react"

/** What the evaluator runs on: data the reader gives it, or an app's output. */
export type RunOnMode = "data" | "app"

interface Step {
    label: string
    variant: NonNullable<BadgeProps["variant"]>
    icon?: Icon
}

interface ModeOption {
    key: RunOnMode | "trace"
    label: string
    shortLabel: string
    icon: Icon
    description: string
    flow: Step[]
    badge?: "default" | "soon"
}

const DATA: Step = {label: "Data", variant: "blue", icon: Database}
const EVALUATOR: Step = {label: "Evaluator", variant: "purple", icon: Gavel}
const SCORE: Step = {label: "Score", variant: "green"}

const MODES: ModeOption[] = [
    {
        key: "data",
        label: "Run directly on a test case",
        shortLabel: "Test case",
        icon: Database,
        description:
            "Evaluate data you provide. Connect a test set, or type the input and output in by hand.",
        flow: [DATA, EVALUATOR, SCORE],
    },
    {
        key: "app",
        label: "Run on an app output",
        shortLabel: "App output",
        icon: AppWindow,
        badge: "default",
        description:
            "Run an app over your data, then the evaluator grades its output. The usual evaluation flow.",
        flow: [
            DATA,
            {label: "App", variant: "outlined", icon: AppWindow},
            {label: "Output", variant: "green"},
            EVALUATOR,
            SCORE,
        ],
    },
    {
        key: "trace",
        label: "Run on a trace",
        shortLabel: "Trace",
        icon: TreeView,
        badge: "soon",
        description: "Pull the input and output straight from a logged trace in Observability.",
        flow: [{label: "Trace", variant: "cyan", icon: TreeView}, EVALUATOR, SCORE],
    },
]

const Flow = ({steps}: {steps: Step[]}) => (
    <div className="flex flex-wrap items-center gap-y-1">
        {steps.map((step, index) => (
            <span key={`${step.label}-${index}`} className="flex items-center">
                {index > 0 ? (
                    <span aria-hidden className="px-1.5 text-xs text-muted-foreground">
                        →
                    </span>
                ) : null}
                <Badge
                    variant={step.variant}
                    icon={step.icon ? <step.icon aria-hidden size={12} /> : undefined}
                    className="rounded-full"
                >
                    {step.label}
                </Badge>
            </span>
        ))}
    </div>
)

/**
 * The "Run on" control of the evaluator playground: a button with the mode in effect, and a list
 * of the modes, each with what it does and how the data flows. "Run on a trace" is not available
 * yet and shows disabled.
 */
export const RunOnSelector = ({
    mode,
    onPick,
}: {
    mode: RunOnMode
    onPick: (mode: RunOnMode) => void
}) => {
    const [open, setOpen] = useState(false)
    const current = MODES.find((option) => option.key === mode) ?? MODES[1]

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                    <span className="font-normal text-muted-foreground">Run on:</span>
                    <current.icon aria-hidden size={14} />
                    <span className="truncate">{current.shortLabel}</span>
                    <CaretDown aria-hidden size={12} className="text-muted-foreground" />
                </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(460px,calc(100vw-32px))] p-1.5">
                <p className="m-0 px-2.5 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    What should the evaluator run on?
                </p>
                <div role="listbox" aria-label="Run on">
                    {MODES.map((option) => {
                        const selected = option.key === mode
                        const disabled = option.key === "trace"
                        return (
                            <button
                                key={option.key}
                                type="button"
                                role="option"
                                aria-selected={selected}
                                disabled={disabled}
                                onClick={() => {
                                    if (option.key === "trace") return
                                    onPick(option.key)
                                    setOpen(false)
                                }}
                                className={cn(
                                    "flex w-full items-start gap-3 rounded-md border-0 bg-transparent p-2.5 text-left",
                                    selected ? "bg-accent" : "hover:bg-accent/60",
                                    disabled && "cursor-default opacity-55 hover:bg-transparent",
                                )}
                            >
                                <span className="mt-0.5 flex w-4 shrink-0 justify-center text-primary">
                                    {selected ? <Check aria-hidden size={16} /> : null}
                                </span>
                                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                    <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                                        <option.icon aria-hidden size={15} />
                                        {option.label}
                                        {option.badge === "default" ? (
                                            <Badge variant="info" className="rounded-full">
                                                default
                                            </Badge>
                                        ) : null}
                                        {option.badge === "soon" ? (
                                            <Badge variant="gold" className="rounded-full">
                                                soon
                                            </Badge>
                                        ) : null}
                                    </span>
                                    <span className="text-xs leading-snug text-muted-foreground">
                                        {option.description}
                                    </span>
                                    <span className="mt-1.5">
                                        <Flow steps={option.flow} />
                                    </span>
                                </span>
                            </button>
                        )
                    })}
                </div>
            </PopoverContent>
        </Popover>
    )
}
