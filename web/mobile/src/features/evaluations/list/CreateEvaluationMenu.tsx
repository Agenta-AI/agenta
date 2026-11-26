import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import type {EvaluationKindTab} from "./useEvaluationRunsFilters"

/** The kinds a user can start from this page. */
export type CreatableKind = "auto" | "human" | "online" | "custom"

const ITEMS: {kind: CreatableKind; title: string; description: string}[] = [
    {
        kind: "auto",
        title: "Auto evaluation",
        description: "Run test sets with configured evaluators for fast iteration.",
    },
    {
        kind: "human",
        title: "Human evaluation",
        description: "Collect human votes or ratings on evaluation outputs.",
    },
    {
        kind: "online",
        title: "Live evaluation",
        description: "Evaluate live traffic with an automatic evaluator.",
    },
    {
        kind: "custom",
        title: "SDK evaluation",
        description: "Run evaluations programmatically using the Agenta SDK.",
    },
]

/** The kind that a tab's create button starts, or null where the tab has none. */
export const creatableKindOf = (tab: EvaluationKindTab): CreatableKind | null =>
    tab === "all" ? null : tab

/** The create entry. The All tab opens a menu of kinds. A kind tab opens that kind directly. */
export const CreateEvaluationMenu = ({
    tab,
    onCreate,
    kinds,
    label = "New evaluation",
    variant = "default",
}: {
    tab: EvaluationKindTab
    onCreate: (kind: CreatableKind) => void
    /** The kinds this page can start. Absent: all of them. */
    kinds?: readonly CreatableKind[]
    label?: string
    variant?: "default" | "outline"
}) => {
    const items = kinds ? ITEMS.filter((item) => kinds.includes(item.kind)) : ITEMS
    if (tab !== "all") {
        const kind = creatableKindOf(tab)
        if (!kind || (kinds && !kinds.includes(kind))) return null
        return (
            <Button size="sm" variant={variant} onClick={() => onCreate(kind)}>
                <Plus aria-hidden size={14} />
                {label}
            </Button>
        )
    }

    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button size="sm" variant={variant}>
                    <Plus aria-hidden size={14} />
                    {label}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-[300px]">
                {items.map((item) => (
                    <DropdownMenuItem
                        key={item.kind}
                        className="flex-col items-start gap-0.5"
                        onSelect={() => onCreate(item.kind)}
                    >
                        <span className="text-[13px] font-medium">{item.title}</span>
                        <span className="text-[12px] text-muted-foreground">
                            {item.description}
                        </span>
                    </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}
