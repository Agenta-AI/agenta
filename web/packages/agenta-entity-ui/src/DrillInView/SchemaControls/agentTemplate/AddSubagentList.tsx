/** "Add subagents" (F03 f1): pick the agents this agent can call. Presentational: every agent
 *  arrives as a prop, and the view that mounts it gives the chrome and "Done". */
import {useMemo, useState, type ReactNode} from "react"

import {useT} from "@agenta/i18n"
import commonCatalog from "@agenta/i18n/catalogs/common"
import addSubagentCatalog from "@agenta/i18n/catalogs/entityUi.addSubagent"
import integrationViewsCatalog from "@agenta/i18n/catalogs/entityUi.integrationViews"
import subagentViewsCatalog from "@agenta/i18n/catalogs/entityUi.subagentViews"
import uiControlsCatalog from "@agenta/i18n/catalogs/ui.controls"
import {agentIconChrome, type AgentIconSelection} from "@agenta/ui/agent-icon"
import {EmptyState, SearchInput, SimpleTooltip} from "@agenta/ui/composed"
import {cn} from "@agenta/ui/styles"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {Check, DotsThreeVertical, Plus, Robot, Trash} from "@phosphor-icons/react"

import {ScrollFadeArea} from "../../../shared/ScrollFadeArea"

import {CatalogListRow} from "./CatalogListRow"
import {CatalogGroupSkeleton} from "./CatalogRowSkeleton"

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

/** The catalog's quiet row action: `secondary` stacks on the row's hover fill (SURF-06). */
const ROW_ACTION = "text-muted-foreground hover:bg-secondary hover:text-foreground"

/** The agent's own icon and tile color, or the agents list's grey Robot. */
function SubagentTile({icon}: {icon?: AgentIconSelection | null}) {
    const chrome = agentIconChrome(icon, {
        size: 16,
        fallbackGlyph: <Robot aria-hidden size={16} />,
        fallbackClassName: "bg-secondary text-muted-foreground",
    })
    return (
        <span
            className={cn(
                "flex size-8 shrink-0 items-center justify-center rounded-md",
                chrome.className,
            )}
            style={chrome.style}
        >
            {chrome.glyph}
        </span>
    )
}

function Description({option}: {option: SubagentOption}) {
    const t = useT(addSubagentCatalog)
    const text = option.description?.trim() || t("entityUi.addSubagent.noDescription")
    return (
        <span className="truncate text-meta text-muted-foreground" title={text}>
            {text}
        </span>
    )
}

/** An agent already called: "✓ Added" and a menu that removes it, as an added skill's row. */
function AddedRow({
    option,
    busy,
    onRemove,
}: {
    option: SubagentOption
    busy?: boolean
    onRemove: () => void
}) {
    const t = useT(
        addSubagentCatalog,
        subagentViewsCatalog,
        integrationViewsCatalog,
        uiControlsCatalog,
    )
    return (
        <CatalogListRow
            variant="canvas"
            leading={<SubagentTile icon={option.icon} />}
            title={option.name}
            action={
                <span className="flex items-center gap-1">
                    <span className="flex shrink-0 items-center gap-1 text-meta text-muted-foreground">
                        <Check size={14} />
                        {t("entityUi.subagentViews.added")}
                    </span>
                    <DropdownMenu>
                        <SimpleTooltip title={t("ui.controls.moreActions")}>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    size="icon-sm"
                                    variant="ghost"
                                    disabled={busy}
                                    aria-label={t("ui.controls.moreActions")}
                                    className={`${ROW_ACTION} aria-expanded:bg-secondary`}
                                >
                                    <DotsThreeVertical aria-hidden />
                                </Button>
                            </DropdownMenuTrigger>
                        </SimpleTooltip>
                        <DropdownMenuContent align="end">
                            <DropdownMenuItem
                                onSelect={onRemove}
                                aria-label={t("entityUi.addSubagent.removeAsSubagent", {
                                    name: option.name,
                                })}
                            >
                                <Trash />
                                {t("entityUi.integrationViews.removeFromAgent")}
                            </DropdownMenuItem>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </span>
            }
        >
            <Description option={option} />
        </CatalogListRow>
    )
}

/** An agent not called yet: the row and its "+" add it. */
function AvailableRow({
    option,
    busy,
    onAdd,
}: {
    option: SubagentOption
    busy?: boolean
    onAdd: () => void
}) {
    const t = useT(addSubagentCatalog, commonCatalog)
    const label = t("entityUi.addSubagent.addAsSubagent", {name: option.name})
    return (
        <CatalogListRow
            variant="canvas"
            onClick={busy ? undefined : onAdd}
            actionLabel={label}
            leading={<SubagentTile icon={option.icon} />}
            title={option.name}
            action={
                <SimpleTooltip title={t("common.add")}>
                    <Button
                        variant="ghost"
                        size="icon-sm"
                        disabled={busy}
                        // Shown on row hover and focus, always on touch (TOUCH-02).
                        className={`${ROW_ACTION} focus-visible:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:hover)]:opacity-0`}
                        aria-label={label}
                        onClick={onAdd}
                    >
                        <Plus />
                    </Button>
                </SimpleTooltip>
            }
        >
            <Description option={option} />
        </CatalogListRow>
    )
}

/** The catalog's group: a heading, 8px, then the rows. */
function RowGroup({label, children}: {label: ReactNode; children: ReactNode}) {
    return (
        <div className="flex flex-col">
            <div className="flex items-center pt-3 text-subtitle text-foreground">{label}</div>
            {/* -mx/px: the rows' hover fill and focus ring stay inside the scroll's clip. */}
            <div className="-mx-2 flex flex-col gap-2 px-2 pt-2">{children}</div>
        </div>
    )
}

/** The loaded list's shape: Added and All agents (STATE-02). */
function ListSkeleton() {
    return (
        <div aria-hidden className="flex flex-col gap-2">
            <CatalogGroupSkeleton rows={3} />
            <CatalogGroupSkeleton rows={3} />
        </div>
    )
}

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

    const added = visible.filter((o) => o.added)
    const others = visible.filter((o) => !o.added)

    return (
        <div className="flex min-h-0 flex-1 flex-col pt-3">
            {/* Fixed above the scroll, as the catalog's. pt-1 keeps the focus ring inside the clip. */}
            <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-1">
                <SearchInput
                    className="min-w-0 flex-1 border-border-muted"
                    placeholder={t("entityUi.addSubagent.searchAgents")}
                    aria-label={t("entityUi.addSubagent.searchAgents")}
                    value={search}
                    onValueChange={setSearch}
                />
            </div>

            <ScrollFadeArea className="flex min-h-0 flex-1 flex-col gap-2 px-4 pb-3">
                {loading ? (
                    <ListSkeleton />
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
                    <>
                        {added.length > 0 ? (
                            <RowGroup label={t("entityUi.addSubagent.addedGroup")}>
                                {added.map((option) => (
                                    <AddedRow
                                        key={option.id}
                                        option={option}
                                        busy={busy}
                                        onRemove={() => void run(() => onRemove([option]))}
                                    />
                                ))}
                            </RowGroup>
                        ) : null}
                        {others.length > 0 ? (
                            <RowGroup label={t("entityUi.addSubagent.allAgents")}>
                                {others.map((option) => (
                                    <AvailableRow
                                        key={option.id}
                                        option={option}
                                        busy={busy}
                                        onAdd={() => void run(() => onAdd([option]))}
                                    />
                                ))}
                            </RowGroup>
                        ) : null}
                    </>
                )}

                {/* One line at the end of the list: the agents that are listed still work. */}
                {!loading && failedCount > 0 ? (
                    <div
                        role="status"
                        className="flex items-center gap-2 pt-3 text-meta text-muted-foreground"
                    >
                        <span className="min-w-0 flex-1">
                            {t("entityUi.addSubagent.agentsNotLoaded", {count: failedCount})}
                        </span>
                        {onRetry ? (
                            <Button variant="outline" size="compact" onClick={onRetry}>
                                {t("entityUi.addSubagent.retry")}
                            </Button>
                        ) : null}
                    </div>
                ) : null}
            </ScrollFadeArea>
        </div>
    )
}
