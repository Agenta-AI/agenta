/** "Add subagents" (F03 f1): pick the agents this agent can call. Presentational: every agent
 *  arrives as a prop, and the view that mounts it gives the chrome and "Done". */
import {useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import addSubagentCatalog from "@agenta/i18n/catalogs/entityUi.addSubagent"
import subagentViewsCatalog from "@agenta/i18n/catalogs/entityUi.subagentViews"
import {agentIconChrome, type AgentIconSelection} from "@agenta/ui/agent-icon"
import {LogoMarks} from "@agenta/ui/components/presentational"
import {ListTableToolbar} from "@agenta/ui/list-table"
import {cn} from "@agenta/ui/styles"
import {Button, EmptyState, SkeletonBlock} from "@agenta/ui/ui"
import {Plus, Robot} from "@phosphor-icons/react"

import {ScrollFadeArea} from "../../../shared/ScrollFadeArea"

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

export interface AddSubagentListProps {
    /** Every agent in the project, minus the one being edited. */
    options: SubagentOption[]
    loading?: boolean
    /** How many agents could not be loaded, so the list can say so instead of hiding them. */
    failedCount?: number
    onRetry?: () => void
    /** One write per author action. May be async; the list disables its actions until it settles. */
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
 *  list's tint and say "Added". */
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
    const t = useT(addSubagentCatalog, subagentViewsCatalog)
    const integrations = option.integrations ?? []
    return (
        <button
            type="button"
            disabled={busy}
            onClick={option.added ? onRemove : onAdd}
            aria-pressed={Boolean(option.added)}
            aria-label={
                option.added
                    ? t("entityUi.addSubagent.removeAsSubagent", {name: option.name})
                    : t("entityUi.addSubagent.addAsSubagent", {name: option.name})
            }
            className={cn(ROW, option.added && "bg-accent")}
        >
            <SubagentTile icon={option.icon} />
            {/* The description line renders even when empty so rows keep one height. */}
            <span className="flex min-w-0 flex-1 flex-col gap-px">
                <span className="truncate text-sm leading-[1.45] text-foreground">
                    {option.name}
                </span>
                <span className="truncate text-[13px] leading-[1.45] text-muted-foreground">
                    {option.description?.trim() || t("entityUi.addSubagent.noDescription")}
                </span>
            </span>
            {integrations.length > 0 ? (
                <span className="hidden shrink-0 items-center pl-2 sm:flex">
                    <LogoMarks
                        items={integrations}
                        size={14}
                        max={5}
                        label={t("entityUi.addSubagent.appsConnectedTo", {name: option.name})}
                    />
                </span>
            ) : null}
            {option.added ? (
                <span className="ml-2 shrink-0 text-[13px] text-muted-foreground">
                    {t("entityUi.subagentViews.added")}
                </span>
            ) : (
                <Plus aria-hidden size={14} className="ml-2 shrink-0 text-muted-foreground" />
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

export function AddSubagentList({
    options,
    loading,
    failedCount = 0,
    onRetry,
    onAdd,
    onRemove,
}: AddSubagentListProps) {
    const t = useT(addSubagentCatalog)
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

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return options
        return options.filter(
            (o) =>
                o.name.toLowerCase().includes(q) || (o.description ?? "").toLowerCase().includes(q),
        )
    }, [options, search])

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* The Agents page's search bar, so this list and the page it mirrors match. */}
            <ListTableToolbar
                className="mb-0 shrink-0 px-4 pt-3 [&>[data-slot=input-group]]:max-w-none"
                search={search}
                onSearchChange={setSearch}
                searchPlaceholder={t("entityUi.addSubagent.searchAgents")}
            />

            <ScrollFadeArea className="flex min-h-0 flex-1 flex-col gap-3 p-2">
                {loading ? (
                    <div className="flex flex-col gap-0.5">
                        {SKELETON_WIDTHS.map((widths, index) => (
                            <RowSkeleton key={index} widths={widths} />
                        ))}
                    </div>
                ) : visible.length === 0 && failedCount === 0 ? (
                    <EmptyState
                        title={
                            search.trim()
                                ? t("entityUi.addSubagent.noAgentsMatch")
                                : t("entityUi.addSubagent.noAgentsYet")
                        }
                        description={
                            search.trim()
                                ? t("entityUi.addSubagent.tryDifferentName")
                                : t("entityUi.addSubagent.createAgentFirst")
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

                {/* One line at the end of the list: the agents that are listed still work. */}
                {!loading && failedCount > 0 ? (
                    <div
                        role="status"
                        className="mx-1.5 flex items-center gap-2 px-2 text-xs text-muted-foreground"
                    >
                        <span className="min-w-0 flex-1">
                            {t("entityUi.addSubagent.agentsNotLoaded", {count: failedCount})}
                        </span>
                        {onRetry ? (
                            <Button variant="outline" size="sm" onClick={onRetry}>
                                {t("entityUi.addSubagent.retry")}
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </ScrollFadeArea>
        </div>
    )
}
