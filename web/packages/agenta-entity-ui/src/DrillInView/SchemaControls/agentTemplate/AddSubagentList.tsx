/** "Add subagents" (F03 f1): pick the agents this agent can call. Presentational: every agent
 *  arrives as a prop, and the view that mounts it gives the chrome and "Done". */
import {useMemo, useState} from "react"

import {useT} from "@agenta/i18n"
import addSubagentCatalog from "@agenta/i18n/catalogs/entityUi.addSubagent"
import subagentViewsCatalog from "@agenta/i18n/catalogs/entityUi.subagentViews"
import {agentIconChrome, type AgentIconSelection} from "@agenta/ui/agent-icon"
import {cn} from "@agenta/ui/styles"
import {Button, EmptyState, SearchInput, SkeletonBlock} from "@agenta/ui/ui"
import {Check, Plus, Robot} from "@phosphor-icons/react"

import {ScrollFadeArea} from "../../../shared/ScrollFadeArea"

/** One connected app on an agent. Kept for the package's public types; the picker no longer
 *  draws these (canvas F03 f1). */
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

const FOCUS_RING = "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
/** Canvas F03 f1: rows on the search field's edge, 8 px above and below; the hover fill and the
 *  focus ring bleed 8 px past the column. */
const ROW =
    "-mx-2 box-border flex w-[calc(100%+16px)] cursor-pointer appearance-none items-center gap-2.5 rounded-lg border-0 bg-transparent px-2 py-2 text-left font-[inherit] outline-none transition-colors hover:bg-colorFillQuaternary disabled:cursor-not-allowed " +
    FOCUS_RING

/** The agent's tile: 32 px, radius 8, a 14 px glyph; the agent type's blue when the author never
 *  picked an icon (canvas F03 f1). */
function SubagentTile({icon}: {icon?: AgentIconSelection | null}) {
    const chrome = agentIconChrome(icon, {
        size: 14,
        fallbackGlyph: <Robot aria-hidden size={14} />,
        fallbackClassName: "bg-[var(--ag-type-agent-bg)] text-[var(--ag-type-agent-text)]",
    })
    return (
        <span
            className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-[8px]",
                chrome.className,
            )}
            style={chrome.style}
        >
            {chrome.glyph}
        </span>
    )
}

/** One row toggles its agent: click adds it, click again removes it. Added rows say "✓ Added". */
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
            className={ROW}
        >
            <SubagentTile icon={option.icon} />
            {/* The description line renders even when empty so rows keep one height. */}
            <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-[13px] font-medium leading-5 text-colorText">
                    {option.name}
                </span>
                <span className="truncate text-[12px] leading-4 text-colorTextSecondary">
                    {option.description?.trim() || t("entityUi.addSubagent.noDescription")}
                </span>
            </span>
            {option.added ? (
                <span className="ml-2 flex shrink-0 items-center gap-1 text-[12px] leading-4 text-colorTextSecondary">
                    <Check aria-hidden size={14} />
                    {t("entityUi.subagentViews.added")}
                </span>
            ) : (
                // The canvas "+" target: 28 px, a 14 px glyph. The row is the button.
                <span className="ml-2 flex size-7 shrink-0 items-center justify-center text-colorTextSecondary">
                    <Plus aria-hidden size={14} />
                </span>
            )}
        </button>
    )
}

/** A loading row in the row's own geometry, so the list replaces it without shifting. */
function RowSkeleton({widths}: {widths: [string, string]}) {
    return (
        <div className="flex items-center gap-2.5 py-2">
            <SkeletonBlock className="size-8 shrink-0 rounded-[8px]" />
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
            {/* Canvas F03 f1: a 30 px search field, radius 6, 13 px. */}
            <div className="shrink-0 px-4 pt-3">
                <SearchInput
                    className="h-[30px] rounded-[6px] border-colorBorderSecondary max-md:h-11 md:[&_input]:text-[13px]"
                    placeholder={t("entityUi.addSubagent.searchAgents")}
                    aria-label={t("entityUi.addSubagent.searchAgents")}
                    value={search}
                    onValueChange={setSearch}
                />
            </div>

            <ScrollFadeArea className="flex min-h-0 flex-1 flex-col gap-3 px-4 py-2">
                {loading ? (
                    <div className="flex flex-col">
                        {SKELETON_WIDTHS.map((widths, index) => (
                            <RowSkeleton key={index} widths={widths} />
                        ))}
                    </div>
                ) : visible.length === 0 && (failedCount === 0 || search.trim()) ? (
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
                    <div className="flex flex-col">
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
                        className="flex items-center gap-2 text-xs text-muted-foreground"
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
