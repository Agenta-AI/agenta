/** Pick the agents this agent can call. Presentational: every agent arrives as a prop. */
import {useEffect, useMemo, useState} from "react"

import {agentIconChrome, type AgentIconSelection} from "@agenta/ui/agent-icon"
import {LogoMarks} from "@agenta/ui/components/presentational"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {cn} from "@agenta/ui/styles"
import {Button, EmptyState, SkeletonBlock} from "@agenta/ui/ui"
import {Check, Robot, Warning} from "@phosphor-icons/react"

import {INTEGRATION_DRAWER_WIDTH} from "./drawerWidths"

/** One connected app on an agent. */
export interface SubagentIntegration {
    /** Integration key, e.g. "github". Doubles as the React key and the fallback label. */
    key: string
    name?: string
    logo?: string | null
}

/** One selectable agent. */
export interface SubagentOption {
    /** The agent's identity, and the key the caller adds and removes by. */
    id: string
    name: string
    description?: string
    /** The agent's chosen icon. Falls back to a robot glyph when the author never picked one. */
    icon?: AgentIconSelection | null
    /** The model this agent runs on, e.g. "claude-sonnet-4-5". */
    model?: string
    /** Provider display name, e.g. "Anthropic". An unknown name draws a neutral glyph. */
    provider?: string
    integrations?: SubagentIntegration[]
    /** Already a subagent of the agent being edited. Its action removes instead of adding. */
    added?: boolean
}

export interface AddSubagentDrawerProps {
    open: boolean
    onClose: () => void
    /** Every agent in the project, minus the one being edited. */
    options: SubagentOption[]
    loading?: boolean
    /** How many agents could not be loaded, so the list can say so instead of hiding them. */
    failedCount?: number
    onRetry?: () => void
    /** One write per author action. May be async; the drawer disables its actions until it settles. */
    onAdd: (options: SubagentOption[]) => void | Promise<void>
    onRemove: (options: SubagentOption[]) => void | Promise<void>
}

/** The home list's row and focus recipe, so this list and that one read as the same agents. */
const FOCUS_RING = "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
const ROW =
    "box-border flex w-full cursor-pointer appearance-none items-center gap-3.5 rounded-[10px] border-0 bg-transparent px-3.5 py-2 text-left font-[inherit] outline-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-60 " +
    FOCUS_RING

/** The home tile: 34px box, 16px glyph, a neutral fill when the author never picked an icon. */
function SubagentTile({icon}: {icon?: AgentIconSelection | null}) {
    const chrome = agentIconChrome(icon, {
        size: 16,
        fallbackGlyph: <Robot aria-hidden size={16} />,
        fallbackClassName: "bg-colorFillSecondary text-muted-foreground",
    })
    return (
        <span
            className={cn(
                "flex size-[34px] shrink-0 items-center justify-center rounded-control-sm",
                chrome.className,
            )}
            style={chrome.style}
        >
            {chrome.glyph}
        </span>
    )
}

/** One row toggles its agent: click adds it, click again removes it. Added rows carry the home
 *  list's tint and check. */
function SubagentRow({
    option,
    busy,
    onAdd,
    onRemove,
}: {
    option: SubagentOption
    busy?: boolean
    onAdd: () => void
    onRemove: () => void
}) {
    const integrations = option.integrations ?? []
    return (
        <button
            type="button"
            disabled={busy}
            onClick={option.added ? onRemove : onAdd}
            aria-pressed={Boolean(option.added)}
            aria-label={`${option.added ? "Remove" : "Add"} ${option.name} as a subagent`}
            className={cn(ROW, option.added && "bg-accent")}
        >
            <SubagentTile icon={option.icon} />
            {/* The description line renders even when empty so rows keep one height. */}
            <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-sm leading-[1.45] text-foreground">
                    {option.name}
                </span>
                <span className="truncate text-[13px] leading-[1.45] text-muted-foreground">
                    {option.description?.trim() || "No description"}
                </span>
            </span>
            {integrations.length > 0 ? (
                <span className="hidden shrink-0 items-center pl-2 sm:flex">
                    <LogoMarks
                        items={integrations}
                        size={14}
                        max={5}
                        label={`Apps connected to ${option.name}`}
                    />
                </span>
            ) : null}
            {option.added ? (
                <Check aria-hidden size={14} className="ml-2 shrink-0 text-foreground" />
            ) : (
                <span className="ml-2 shrink-0 text-[13px] text-muted-foreground">Add</span>
            )}
        </button>
    )
}

/** A loading row in the row's own geometry, so the list replaces it without shifting. */
function RowSkeleton({widths}: {widths: [string, string]}) {
    return (
        <div className="flex items-center gap-3.5 px-3.5 py-2">
            <SkeletonBlock className="size-[34px] shrink-0 rounded-control-sm" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <SkeletonBlock className={`h-3.5 ${widths[0]}`} />
                <SkeletonBlock className={`h-3 ${widths[1]}`} />
            </div>
        </div>
    )
}

/** Uneven widths: three identical bars read as a loading graphic, not as rows about to arrive. */
const SKELETON_WIDTHS: [string, string][] = [
    ["w-36", "w-full"],
    ["w-28", "w-4/5"],
    ["w-44", "w-3/5"],
]

export function AddSubagentDrawer({
    open,
    onClose,
    options,
    loading,
    failedCount = 0,
    onRetry,
    onAdd,
    onRemove,
}: AddSubagentDrawerProps) {
    const [search, setSearch] = useState("")
    // One write in flight at a time: two overlapping ones both start from the same array.
    const [busy, setBusy] = useState(false)
    const run = async (write: () => void | Promise<void>) => {
        if (busy) return
        setBusy(true)
        try {
            await write()
        } finally {
            setBusy(false)
        }
    }

    // Reset on the `open` transition: `destroyOnClose` unmounts the body, not this component.
    useEffect(() => {
        if (!open) setSearch("")
    }, [open])

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return options
        return options.filter(
            (o) =>
                o.name.toLowerCase().includes(q) || (o.description ?? "").toLowerCase().includes(q),
        )
    }, [options, search])

    const handleClose = () => {
        setSearch("")
        onClose()
    }

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={handleClose}
            placement="right"
            width={INTEGRATION_DRAWER_WIDTH}
            destroyOnClose
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <span className="shrink-0 text-sm font-medium">Add subagents</span>
                    <span className="min-w-0 truncate text-xs font-normal text-[var(--ag-colorTextSecondary)]">
                        · Pick the agents this agent can call.
                    </span>
                </div>
            }
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            // Each row adds itself, so the only thing left for the footer is to close.
            footer={
                <div className="flex items-center justify-end">
                    <Button variant="default" onClick={handleClose}>
                        Done
                    </Button>
                </div>
            }
        >
            {/* The Agents page's search bar, so the drawer and the page it mirrors match. */}
            <ListTableToolbar
                className="mb-0 shrink-0 px-4 pt-4 [&>[data-slot=input-group]]:max-w-none"
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder="Search agents by name…"
            />

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2">
                {failedCount > 0 ? (
                    <div className="mx-1.5 flex items-center gap-2 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2 text-xs text-[var(--ag-colorWarningText)]">
                        <Warning size={14} className="shrink-0" />
                        <span className="min-w-0 flex-1">
                            {failedCount} {failedCount === 1 ? "agent" : "agents"} could not be
                            loaded, so {failedCount === 1 ? "it is" : "they are"} not listed.
                        </span>
                        {onRetry ? (
                            <Button variant="outline" size="sm" onClick={onRetry}>
                                Retry
                            </Button>
                        ) : null}
                    </div>
                ) : null}

                {loading ? (
                    <div className="flex flex-col gap-0.5">
                        {SKELETON_WIDTHS.map((widths, index) => (
                            <RowSkeleton key={index} widths={widths} />
                        ))}
                    </div>
                ) : visible.length === 0 ? (
                    <EmptyState
                        title={search.trim() ? "No agents match your search" : "No agents yet"}
                        description={
                            search.trim()
                                ? "Try a different name."
                                : "Create an agent, then come back to add it here."
                        }
                    />
                ) : (
                    <div className="flex flex-col gap-0.5">
                        {visible.map((option) => (
                            <SubagentRow
                                key={option.id}
                                option={option}
                                busy={busy}
                                onAdd={() => void run(() => onAdd([option]))}
                                onRemove={() => void run(() => onRemove([option]))}
                            />
                        ))}
                    </div>
                )}
            </div>
        </EnhancedDrawer>
    )
}
