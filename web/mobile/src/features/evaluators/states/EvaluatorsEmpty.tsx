import type {EvaluatorCategory} from "@agenta/entities/workflow"
import {Button, Empty, EmptyContent, EmptyHeader, EmptyMedia, EmptyTitle} from "@agenta/ui/ui"
import {ChartDonut} from "@phosphor-icons/react"
import {Archive, Search} from "lucide-react"

/**
 * No evaluators in this tab, or none that match the search; offers the way back from a search.
 * `archived` says which list is empty.
 */
export const EvaluatorsEmpty = ({
    category,
    archived = false,
    term,
    onClear,
}: {
    category: EvaluatorCategory
    archived?: boolean
    term?: string
    onClear?: () => void
}) => {
    const Icon = term ? Search : archived ? Archive : ChartDonut
    const title = term
        ? `No evaluators match “${term}”`
        : archived
          ? "No archived evaluators"
          : category === "human"
            ? "No human evaluators"
            : "No automatic evaluators"
    return (
        <Empty className="py-14">
            <EmptyHeader>
                <EmptyMedia variant="icon">
                    <Icon />
                </EmptyMedia>
                <EmptyTitle>{title}</EmptyTitle>
            </EmptyHeader>
            {term && onClear ? (
                <EmptyContent>
                    <Button size="sm" variant="outline" onClick={onClear}>
                        Clear search
                    </Button>
                </EmptyContent>
            ) : null}
        </Empty>
    )
}
