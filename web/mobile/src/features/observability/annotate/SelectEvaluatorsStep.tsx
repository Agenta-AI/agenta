import {useState} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import {Checkbox, SearchInput, SimpleTooltip} from "@agenta/ui/ui"

import {SelectEvaluatorsEmpty} from "./states/SelectEvaluatorsEmpty"
import {SelectEvaluatorsError} from "./states/SelectEvaluatorsError"
import {SelectEvaluatorsSkeleton} from "./states/SelectEvaluatorsSkeleton"

/**
 * The Select Evaluators step: a searchable check list of the project's human evaluators. An
 * evaluator the user already annotated with stays checked and cannot be removed.
 */
export const SelectEvaluatorsStep = ({
    evaluators,
    isLoading,
    loadFailed,
    onRetry,
    selected,
    lockedSlugs,
    onChange,
    evaluatorsHref,
}: {
    evaluators: readonly Workflow[]
    isLoading: boolean
    loadFailed: boolean
    onRetry: () => void
    selected: readonly string[]
    lockedSlugs: readonly string[]
    onChange: (slugs: string[]) => void
    evaluatorsHref: string | null
}) => {
    const [search, setSearch] = useState("")

    if (isLoading) return <SelectEvaluatorsSkeleton />
    if (loadFailed) return <SelectEvaluatorsError onRetry={onRetry} />
    if (evaluators.length === 0) return <SelectEvaluatorsEmpty evaluatorsHref={evaluatorsHref} />

    const term = search.trim().toLowerCase()
    const shown = evaluators.filter(
        (evaluator) => !term || (evaluator.name ?? "").toLowerCase().includes(term),
    )

    const toggle = (slug: string, checked: boolean) =>
        onChange(checked ? [...selected, slug] : selected.filter((item) => item !== slug))

    return (
        <div className="flex flex-col gap-3">
            <SearchInput
                placeholder="Search"
                aria-label="Search evaluators"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
            />
            {shown.length === 0 ? (
                <p className="m-0 py-6 text-center text-sm text-muted-foreground">
                    No results found
                </p>
            ) : (
                <ul className="m-0 flex list-none flex-col p-0">
                    {shown.map((evaluator) => {
                        const slug = evaluator.slug ?? ""
                        const name = evaluator.name || slug
                        const locked = lockedSlugs.includes(slug)
                        return (
                            <li key={evaluator.id} data-testid="evaluator-row">
                                <SimpleTooltip title={evaluator.description} side="left">
                                    <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 hover:bg-muted has-[:disabled]:cursor-not-allowed">
                                        <Checkbox
                                            aria-label={name}
                                            checked={locked || selected.includes(slug)}
                                            disabled={locked || !slug}
                                            onCheckedChange={(next) => toggle(slug, next === true)}
                                        />
                                        <span className="min-w-0 flex-1 truncate text-sm">
                                            {name}
                                        </span>
                                        <span className="shrink-0 text-xs text-muted-foreground">
                                            Metric
                                        </span>
                                    </label>
                                </SimpleTooltip>
                            </li>
                        )
                    })}
                </ul>
            )}
        </div>
    )
}
