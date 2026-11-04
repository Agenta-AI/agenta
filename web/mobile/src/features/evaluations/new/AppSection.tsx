import {useMemo, useState} from "react"

import {LoadError} from "@agenta/ui/components/presentational"
import {Input, SkeletonRows} from "@agenta/ui/ui"
import {CheckIcon} from "@phosphor-icons/react"

import {toDraftApp, useEvaluableApps} from "./appList"
import type {DraftApp} from "./newEvaluationDraft"
import {SectionHint} from "./SectionHint"

/** Pick the app to evaluate: a searchable list, one pick. */
export const AppSection = ({
    selectedId,
    disabled,
    onPick,
}: {
    selectedId: string | null
    /** The page is scoped to an app, so the pick cannot change. */
    disabled?: boolean
    onPick: (app: DraftApp) => void
}) => {
    const {apps, isPending, isError, refetch} = useEvaluableApps()
    const [search, setSearch] = useState("")
    const shown = useMemo(() => {
        const needle = search.trim().toLowerCase()
        return needle
            ? apps.filter((app) => (app.name || app.slug || "").toLowerCase().includes(needle))
            : apps
    }, [apps, search])

    if (isError) {
        return <LoadError title="Could not load apps" onRetry={() => void refetch()} />
    }

    return (
        <div className="flex flex-col gap-3">
            <Input
                value={search}
                placeholder="Search"
                aria-label="Search applications"
                disabled={disabled}
                onChange={(event) => setSearch(event.target.value)}
            />
            {isPending ? (
                <SkeletonRows count={3} />
            ) : shown.length === 0 ? (
                <SectionHint>No applications available</SectionHint>
            ) : (
                <ul
                    aria-label="Applications"
                    className="m-0 flex max-h-64 list-none flex-col gap-1 overflow-y-auto p-0"
                >
                    {shown.map((app) => (
                        <li key={app.id}>
                            <button
                                type="button"
                                aria-pressed={app.id === selectedId}
                                disabled={disabled}
                                onClick={() => onPick(toDraftApp(app))}
                                className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-md border-0 bg-transparent px-3 py-2 text-left text-sm text-foreground hover:bg-muted aria-pressed:bg-muted"
                            >
                                <span className="min-w-0 truncate">{app.name || app.slug}</span>
                                {app.id === selectedId ? (
                                    <CheckIcon aria-hidden className="shrink-0" />
                                ) : null}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    )
}
