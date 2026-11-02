import {useEffect, type ReactNode} from "react"

import {appWorkflowsListQueryStateAtom} from "@agenta/entities/workflow"
import {AgentGlyph} from "@agenta/entity-ui/agent"
import {projectIdAtom} from "@agenta/shared/state"
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from "@agenta/ui/ui"
import {Robot} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

const ICON = 14
const ALL_APPS = "__all__"

export interface AppFilterOption {
    id: string
    name: string
}

/** One row, also what the closed trigger shows: the icon and the name on one line. */
const Option = ({icon, name}: {icon: ReactNode; name: string}) => (
    <span className="flex min-w-0 items-center gap-2">
        {icon}
        <span className="truncate">{name}</span>
    </span>
)

/**
 * The picker itself: no data of its own, so a story can render every state.
 *
 * Radix does not allow an empty item value, so "All apps" is a sentinel that maps to `null`.
 */
export const AppFilterSelect = ({
    apps,
    value,
    disabled,
    onChange,
}: {
    apps: readonly AppFilterOption[]
    value: string | null
    disabled?: boolean
    onChange: (appId: string | null) => void
}) => (
    <Select
        value={value ?? ALL_APPS}
        disabled={disabled}
        onValueChange={(next) => onChange(next === ALL_APPS ? null : next)}
    >
        <SelectTrigger
            size="sm"
            className="w-full min-w-44 max-w-full sm:w-64"
            aria-label="Filter by app"
        >
            <SelectValue />
        </SelectTrigger>
        <SelectContent>
            <SelectItem value={ALL_APPS}>
                <Option icon={<Robot size={ICON} aria-hidden />} name="All apps" />
            </SelectItem>
            {apps.map((app) => (
                <SelectItem key={app.id} value={app.id}>
                    <Option
                        icon={
                            <AgentGlyph
                                workflowId={app.id}
                                size={ICON}
                                fallback={<Robot size={ICON} aria-hidden />}
                            />
                        }
                        name={app.name}
                    />
                </SelectItem>
            ))}
        </SelectContent>
    </Select>
)

/**
 * Narrows the observability screen to one app, over the apps list the nav already loads.
 *
 * Hidden when the list fails, and a picked app is cleared then, so the page stays project wide
 * with no filter left that the user cannot see. A `value` that is not in the list (deleted,
 * archived) is cleared once the list is known.
 */
export const ObservabilityAppFilter = ({
    projectId,
    value,
    onChange,
}: {
    projectId: string
    value: string | null
    onChange: (appId: string | null) => void
}) => {
    const state = useAtomValue(appWorkflowsListQueryStateAtom)
    // The shared project follows the route in an effect, so for one render after a navigation
    // the list can still belong to the previous project. Treat it as loading until they match.
    const listProjectId = useAtomValue(projectIdAtom)
    const {data, isError} = state
    const isPending = state.isPending || listProjectId !== projectId
    const apps = data.map((app) => ({id: app.id, name: (app.name || app.slug || "").trim()}))
    const unknown =
        value !== null && !isPending && (isError || !apps.some((app) => app.id === value))

    useEffect(() => {
        if (unknown) onChange(null)
    }, [onChange, unknown])

    if (isError) return null
    return (
        <AppFilterSelect
            apps={apps}
            value={unknown || isPending ? null : value}
            disabled={isPending}
            onChange={onChange}
        />
    )
}
