import {useState} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import {betaDeveloperModeActiveAtom} from "@agenta/shared/state"
import {Alert, Button, Checkbox, SearchInput, SimpleTooltip} from "@agenta/ui/ui"
import {PlusIcon} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"

import {SelectEvaluatorsEmpty} from "./states/SelectEvaluatorsEmpty"
import {SelectEvaluatorsError} from "./states/SelectEvaluatorsError"
import {SelectEvaluatorsSkeleton} from "./states/SelectEvaluatorsSkeleton"

// The create form is its own chunk: it downloads only when a user creates an evaluator here.
const CreateEvaluatorFlow = dynamic(
    () =>
        import("../../evaluators/create/CreateEvaluatorFlow").then(
            (module) => module.CreateEvaluatorFlow,
        ),
    {ssr: false},
)

/**
 * The Select Evaluators step: a searchable check list of the project's human evaluators. An
 * evaluator the user already annotated with stays checked and cannot be removed. In beta
 * developer mode "Create evaluator" opens the human evaluator form and selects the new one.
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
    const canCreate = useAtomValue(betaDeveloperModeActiveAtom)
    const [creating, setCreating] = useState(false)
    // A new evaluator is selected at once; the list shows it when it loads again.
    const createFlow = creating ? (
        <CreateEvaluatorFlow
            kind="human"
            onClose={() => setCreating(false)}
            onCreated={(created) => onChange([...selected, created.slug])}
        />
    ) : null
    const onCreate = canCreate ? () => setCreating(true) : undefined

    if (isLoading) return <SelectEvaluatorsSkeleton />
    if (loadFailed && evaluators.length === 0) return <SelectEvaluatorsError onRetry={onRetry} />
    if (evaluators.length === 0) {
        return (
            <>
                <SelectEvaluatorsEmpty evaluatorsHref={evaluatorsHref} onCreate={onCreate} />
                {createFlow}
            </>
        )
    }

    const term = search.trim().toLowerCase()
    const shown = evaluators.filter(
        (evaluator) => !term || (evaluator.name ?? "").toLowerCase().includes(term),
    )

    const toggle = (slug: string, checked: boolean) =>
        onChange(checked ? [...selected, slug] : selected.filter((item) => item !== slug))

    return (
        <div className="flex flex-col gap-3">
            {loadFailed ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Some evaluators could not be loaded"
                    action={
                        <Button variant="outline" size="sm" onClick={onRetry}>
                            Try again
                        </Button>
                    }
                />
            ) : null}
            <div className="flex items-center gap-2">
                <SearchInput
                    className="min-w-0 flex-1"
                    placeholder="Search"
                    aria-label="Search evaluators"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                />
                {onCreate ? (
                    <Button variant="outline" size="sm" onClick={onCreate}>
                        <PlusIcon aria-hidden />
                        Create evaluator
                    </Button>
                ) : null}
            </div>
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
            {createFlow}
        </div>
    )
}
