import {useState} from "react"

import {useT, type CatalogKey} from "@agenta/i18n"
import evalCatalog from "@agenta/i18n/catalogs/playground.evaluator"
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

type EvalKey = CatalogKey<typeof evalCatalog>

interface Step {
    label: EvalKey
    variant: NonNullable<BadgeProps["variant"]>
    icon?: Icon
}

interface ModeOption {
    key: RunOnMode | "trace"
    label: EvalKey
    shortLabel: EvalKey
    icon: Icon
    description: EvalKey
    flow: Step[]
    badge?: "default" | "soon"
}

const DATA: Step = {label: "playground.evaluator.stepData", variant: "blue", icon: Database}
const EVALUATOR: Step = {label: "playground.evaluator.evaluator", variant: "purple", icon: Gavel}
const SCORE: Step = {label: "playground.evaluator.stepScore", variant: "green"}

const MODES: ModeOption[] = [
    {
        key: "data",
        label: "playground.evaluator.modeDataLabel",
        shortLabel: "playground.evaluator.modeDataShort",
        icon: Database,
        description: "playground.evaluator.modeDataDescription",
        flow: [DATA, EVALUATOR, SCORE],
    },
    {
        key: "app",
        label: "playground.evaluator.modeAppLabel",
        shortLabel: "playground.evaluator.modeAppShort",
        icon: AppWindow,
        badge: "default",
        description: "playground.evaluator.modeAppDescription",
        flow: [
            DATA,
            {label: "playground.evaluator.stepApp", variant: "outlined", icon: AppWindow},
            {label: "playground.evaluator.stepOutput", variant: "green"},
            EVALUATOR,
            SCORE,
        ],
    },
    {
        key: "trace",
        label: "playground.evaluator.modeTraceLabel",
        shortLabel: "playground.evaluator.modeTraceShort",
        icon: TreeView,
        badge: "soon",
        description: "playground.evaluator.modeTraceDescription",
        flow: [
            {label: "playground.evaluator.stepTrace", variant: "cyan", icon: TreeView},
            EVALUATOR,
            SCORE,
        ],
    },
]

const Flow = ({steps}: {steps: Step[]}) => {
    const t = useT(evalCatalog)
    return (
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
                        {t(step.label)}
                    </Badge>
                </span>
            ))}
        </div>
    )
}

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
    const t = useT(evalCatalog)
    const [open, setOpen] = useState(false)
    const current = MODES.find((option) => option.key === mode) ?? MODES[1]

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                    <span className="font-normal text-muted-foreground">
                        {t("playground.evaluator.runOn")}
                    </span>
                    <current.icon aria-hidden size={14} />
                    <span className="truncate">{t(current.shortLabel)}</span>
                    <CaretDown aria-hidden size={12} className="text-muted-foreground" />
                </Button>
            </PopoverTrigger>
            <PopoverContent
                // Renders outside the page: `data-playground` gives it the playground's colours.
                data-playground
                align="start"
                className="w-[min(460px,calc(100vw-32px))] p-1.5"
            >
                <p className="m-0 px-2.5 pb-1.5 pt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t("playground.evaluator.runOnQuestion")}
                </p>
                <div role="listbox" aria-label={t("playground.evaluator.runOnAria")}>
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
                                        {t(option.label)}
                                        {option.badge === "default" ? (
                                            <Badge variant="info" className="rounded-full">
                                                {t("playground.evaluator.badgeDefault")}
                                            </Badge>
                                        ) : null}
                                        {option.badge === "soon" ? (
                                            <Badge variant="gold" className="rounded-full">
                                                {t("playground.evaluator.badgeSoon")}
                                            </Badge>
                                        ) : null}
                                    </span>
                                    <span className="text-xs leading-snug text-muted-foreground">
                                        {t(option.description)}
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
