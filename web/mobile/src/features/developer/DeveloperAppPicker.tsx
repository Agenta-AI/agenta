import {useMemo} from "react"

import type {Workflow} from "@agenta/entities/workflow"
import {Combobox} from "@agenta/ui/ui"

/** The app a developer view shows. The list is the project's apps; an evaluator is never in it. */
export const DeveloperAppPicker = ({
    apps,
    value,
    onChange,
    loading,
}: {
    apps: readonly Workflow[]
    value: string | null
    onChange: (appId: string) => void
    loading?: boolean
}) => {
    const options = useMemo(
        () =>
            apps.map((app) => {
                const label = app.name || app.slug || app.id
                return {value: app.id, label, searchValue: label}
            }),
        [apps],
    )

    return (
        <Combobox
            aria-label="App"
            options={options}
            value={value ?? undefined}
            onChange={(next) => {
                if (next) onChange(next)
            }}
            placeholder="Pick an app"
            emptyText="No apps"
            loading={loading}
            className="w-full min-w-0 sm:w-[240px]"
        />
    )
}
