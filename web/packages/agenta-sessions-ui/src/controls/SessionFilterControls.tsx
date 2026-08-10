import {useEffect, useRef, useState, type ReactNode} from "react"

import {useSessionFilters, type SessionStatusFilter} from "@agenta/sessions/state"
import {
    SearchInput,
    Segmented,
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
    Switch,
} from "@agenta/ui/ui"
import {MagnifyingGlassIcon} from "@phosphor-icons/react"

import {Tip} from "../assets/Tip"

/** The session filter CONTROLS, each bound to `useSessionFilters`; shells stay per-surface. */

/** Applied filter writes are debounced; every keystroke would otherwise refetch both lists. */
const SEARCH_DEBOUNCE_MS = 300

export const SessionSearchControl = ({
    placeholder = "Search sessions",
    className,
}: {
    placeholder?: string
    className?: string
}) => {
    const {search, setSearch} = useSessionFilters()
    const [draft, setDraft] = useState(search)
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
    // Distinguishes our own debounced write landing from an outside one (reset, another
    // surface) — only the outside write may clobber the draft and cancel a pending write.
    const lastApplied = useRef(search)

    useEffect(() => {
        if (search === lastApplied.current) return
        if (timer.current) {
            clearTimeout(timer.current)
            timer.current = null
        }
        lastApplied.current = search
        setDraft(search)
    }, [search])
    useEffect(
        () => () => {
            if (timer.current) clearTimeout(timer.current)
        },
        [],
    )

    const apply = (value: string) => {
        lastApplied.current = value
        setSearch(value)
    }

    return (
        <SearchInput
            allowClear
            value={draft}
            placeholder={placeholder}
            className={className}
            prefix={<MagnifyingGlassIcon size={14} className="text-colorTextTertiary" />}
            onChange={(event) => {
                const value = event.target.value
                setDraft(value)
                if (timer.current) clearTimeout(timer.current)
                // Clearing applies immediately — an empty box showing filtered rows reads broken.
                if (value === "") apply(value)
                else
                    timer.current = setTimeout(() => {
                        timer.current = null
                        apply(value)
                    }, SEARCH_DEBOUNCE_MS)
            }}
        />
    )
}

/** The status choice, sized for a toolbar row: three exclusive options on one line. */
export const SessionStatusControl = ({waitingCount}: {waitingCount?: number}) => {
    const {status, setStatus} = useSessionFilters()
    return (
        <Segmented
            value={status}
            onChange={(value) => setStatus(value as SessionStatusFilter)}
            // The default track is colorBgLayout, which this palette paints white — on a white
            // toolbar the track and its thumb both disappear.
            className="bg-colorFillTertiary"
            options={[
                {value: "all", label: "All"},
                {value: "live", label: "Live"},
                // The count rides in the label — a toolbar has no room for a separate badge.
                {value: "waiting", label: waitingCount ? `Waiting ${waitingCount}` : "Waiting"},
            ]}
        />
    )
}

const STATUSES: {value: SessionStatusFilter; label: string}[] = [
    {value: "all", label: "All sessions"},
    {value: "live", label: "Live"},
    {value: "waiting", label: "Waiting on you"},
]

/** The status choice as a list, for a rail or a mobile sheet; the toolbar uses
 * {@link SessionStatusControl}. */
export const SessionStatusListControl = ({waitingCount}: {waitingCount?: number}) => {
    const {status, setStatus} = useSessionFilters()
    return (
        // Styling alone doesn't reach AT: the group is named, and each option states its state.
        <div className="flex flex-col gap-0.5" role="group" aria-label="Filter sessions by status">
            {STATUSES.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    aria-pressed={option.value === status}
                    onClick={() => setStatus(option.value)}
                    className={`box-border flex w-full cursor-pointer items-center gap-2 rounded-lg border-0 px-3 py-2 text-left text-sm transition-colors ${
                        option.value === status
                            ? "bg-colorFillSecondary text-colorText"
                            : "bg-transparent text-colorTextSecondary hover:bg-colorFillQuaternary"
                    }`}
                >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {option.value === "waiting" && waitingCount ? (
                        <span className="shrink-0 rounded bg-colorWarningBg px-1.5 py-0.5 text-[11px] leading-none text-colorWarningText">
                            {waitingCount}
                        </span>
                    ) : null}
                </button>
            ))}
        </div>
    )
}

/**
 * The same status choice as one horizontal strip — for a bar shell, where a stacked list would
 * cost the results their screen. Scrolls sideways rather than wrapping, so the row keeps its height.
 */
export const SessionStatusChipsControl = ({
    waitingCount,
    className,
}: {
    waitingCount?: number
    className?: string
}) => {
    const {status, setStatus} = useSessionFilters()
    return (
        // A filter strip is not navigation: `<nav>` would register an unnamed navigation landmark
        // for it. Same named group as {@link SessionStatusListControl}, and each chip states its own
        // pressed state.
        <div
            role="group"
            aria-label="Filter sessions by status"
            className={`flex gap-2 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden ${
                className ?? ""
            }`}
        >
            {STATUSES.map((option) => (
                <button
                    key={option.value}
                    type="button"
                    onClick={() => setStatus(option.value)}
                    aria-pressed={option.value === status}
                    className={`box-border flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border-0 px-3 py-1.5 text-sm leading-tight transition-colors ${
                        option.value === status
                            ? "bg-colorFillSecondary text-colorText"
                            : "bg-colorFillQuaternary text-colorTextSecondary"
                    }`}
                >
                    {option.label}
                    {option.value === "waiting" && waitingCount ? (
                        <span className="rounded bg-colorWarningBg px-1.5 py-0.5 text-[11px] leading-none text-colorWarningText">
                            {waitingCount}
                        </span>
                    ) : null}
                </button>
            ))}
        </div>
    )
}

const ALL_AGENTS = "__all__"

/** The agent picker on the kit Select; the roster comes from the host (each app resolves it). */
export const SessionAgentControl = ({agents}: {agents: {id: string; name: string}[]}) => {
    const {agentId, setAgentId} = useSessionFilters()
    return (
        <Select
            value={agentId ?? ALL_AGENTS}
            onValueChange={(value) => setAgentId(value === ALL_AGENTS ? null : value)}
        >
            <SelectTrigger className="w-full">
                <SelectValue placeholder="All agents" />
            </SelectTrigger>
            <SelectContent>
                <SelectItem value={ALL_AGENTS}>All agents</SelectItem>
                {agents.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                        {agent.name}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

const ToggleRow = ({
    checked,
    onChange,
    tooltip,
    children,
}: {
    checked: boolean
    onChange: (checked: boolean) => void
    tooltip: string
    children: ReactNode
}) => (
    <Tip title={tooltip} side="right">
        <label className="flex cursor-pointer items-center gap-2 text-sm text-colorTextSecondary">
            <Switch checked={checked} onCheckedChange={onChange} />
            {children}
        </label>
    </Tip>
)

/** Picks WHICH sessions: automation runs INSTEAD of the ones you started. */
export const SessionModeControl = () => {
    const {mode, setMode} = useSessionFilters()
    return (
        <ToggleRow
            checked={mode}
            onChange={setMode}
            tooltip="Runs started by an automation, instead of the sessions you started"
        >
            Automation runs
        </ToggleRow>
    )
}

/** Widens the set: archived sessions are hidden but recoverable. */
export const SessionArchivedControl = () => {
    const {includeArchived, setIncludeArchived} = useSessionFilters()
    return (
        <ToggleRow
            checked={includeArchived}
            onChange={setIncludeArchived}
            tooltip="Archived sessions are hidden but recoverable"
        >
            Archived
        </ToggleRow>
    )
}
