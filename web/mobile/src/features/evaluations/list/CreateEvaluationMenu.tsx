import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Plus} from "@phosphor-icons/react"

import type {EvaluationKindTab} from "./useEvaluationRunsFilters"

/** The kinds a user can start from this page. Live creation is not offered yet. */
export type CreatableKind = "auto" | "human" | "custom"

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
        kind: "custom",
        title: "SDK evaluation",
        description: "Run evaluations programmatically using the Agenta SDK.",
    },
]

/** The kind that a tab's create button starts, or null where the tab has none. */
export const creatableKindOf = (tab: EvaluationKindTab): CreatableKind | null =>
    tab === "auto" || tab === "human" || tab === "custom" ? tab : null

/**
 * The create entry. The All tab opens a menu of kinds. A kind tab opens that kind directly,
 * and the Live tab has none.
 */
export const CreateEvaluationMenu = ({
    tab,
    onCreate,
    label = "New evaluation",
    variant = "default",
}: {
    tab: EvaluationKindTab
    onCreate: (kind: CreatableKind) => void
    label?: string
    variant?: "default" | "outline"
}) => {
    if (tab !== "all") {
        const kind = creatableKindOf(tab)
        if (!kind) return null
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
                {ITEMS.map((item) => (
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
