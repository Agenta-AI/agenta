import {useEffect, useRef, useState, type ReactNode} from "react"

import {useSessionFilters, type SessionStatusFilter} from "@agenta/sessions/state"
import {SearchInput, Switch} from "@agenta/ui/ui"
import {MagnifyingGlassIcon} from "@phosphor-icons/react"

import {Tip} from "../assets/Tip"

/**
 * The session filter CONTROLS — each binds to `useSessionFilters`, so every surface narrows the
 * same set. Shells stay per-surface: a 280px rail and a mobile filter sheet are two shells over
 * these same controls, which is why no rail markup lives here. The agent picker is not among
 * them — it stays an app-injected slot (`EntityPicker`/antd `Select` are out of scope).
 */

const STATUSES: {value: SessionStatusFilter; label: string}[] = [
    {value: "all", label: "All sessions"},
    {value: "live", label: "Live"},
    {value: "waiting", label: "Waiting on you"},
]

/** Applied filter writes are debounced; every keystroke would otherwise refetch both lists. */
const SEARCH_DEBOUNCE_MS = 300

export const SessionSearchControl = ({placeholder = "Search sessions"}: {placeholder?: string}) => {
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

/** The status choice as a list you read, not a segmented control you decode. */
export const SessionStatusListControl = ({waitingCount}: {waitingCount?: number}) => {
    const {status, setStatus} = useSessionFilters()
    return (
        <nav className="flex flex-col gap-0.5">
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
        </nav>
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
