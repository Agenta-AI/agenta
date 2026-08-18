import {useEffect, useRef, useState, type ReactNode} from "react"

import {useSessionFilters, type SessionStatusFilter} from "@agenta/sessions/state"
import {SearchInput, Segmented, Switch} from "@agenta/ui/ui"
import {MagnifyingGlassIcon} from "@phosphor-icons/react"

import {Tip} from "../assets/Tip"

/**
 * The session filter CONTROLS — each binds to `useSessionFilters`, so every surface narrows the
 * same set. Shells stay per-surface: a toolbar row and a mobile filter sheet are two shells over
 * these same controls, which is why no shell markup lives here. The agent picker is not among
 * them — it stays an app-injected slot (`EntityPicker`/antd `Select` are out of scope).
 */

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
