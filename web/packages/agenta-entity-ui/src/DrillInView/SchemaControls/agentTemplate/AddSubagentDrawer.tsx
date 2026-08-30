/**
 * AddSubagentDrawer
 *
 * Pick the agents this agent can call, and add several of them in one pass.
 *
 * The surface deliberately shows five things per agent and nothing else: its icon, its name, its
 * description, the model it runs on, and the apps it has connected. No slug, no version, no
 * schema. An author choosing a helper is asking "what does this one do and what can it reach",
 * and every field beyond those five pushed that answer further down the card.
 *
 * The list is agents only. A subagent IS saved as a workflow reference, but nothing on this
 * surface says workflow or reference, because neither word means anything to the person picking.
 *
 * Presentational on purpose: every agent arrives as a prop, so the layout can be storied and
 * iterated without the project's workflow queries. The container resolves the options and the
 * per-agent icons, and turns the confirmed selection into saved entries.
 */
import {useMemo, useState} from "react"

import {agentIconChrome, type AgentIconSelection} from "@agenta/ui/agent-icon"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {LLMIconMap} from "@agenta/ui/llm-icons"
import {cn} from "@agenta/ui/styles"
import {Badge, Checkbox, EmptyState, SearchInput, Skeleton} from "@agenta/ui/ui"
import {Cube, Robot} from "@phosphor-icons/react"

import {DrawerFooter} from "../../../drawers/shared/DrawerFooter"
import {ProviderLogo} from "../sectionGroups"

/** Shared with the integration drawer, so both agent drawers open at the same size. */
import {INTEGRATION_DRAWER_WIDTH} from "./drawerWidths"

/** One connected app on an agent, as the card's meta row shows it. */
export interface SubagentIntegration {
    /** Integration key, e.g. "github". Doubles as the React key. */
    key: string
    /** Display name, e.g. "GitHub". Falls back to the key when the catalog has not loaded. */
    name?: string
    logo?: string | null
}

/** One selectable agent. */
export interface SubagentOption {
    /** The agent's identity, and the key the caller adds by. */
    id: string
    name: string
    description?: string
    /** The agent's chosen icon. Falls back to a robot glyph when the author never picked one. */
    icon?: AgentIconSelection | null
    /** The model this agent runs on, e.g. "claude-sonnet-4-5". */
    model?: string
    /** Provider display name, e.g. "Anthropic". Draws the provider's mark next to the model; a
     *  name the icon map does not know falls back to a neutral glyph. */
    provider?: string
    integrations?: SubagentIntegration[]
    /** Already added to the agent being edited. Listed, but not selectable again. */
    added?: boolean
}

export interface AddSubagentDrawerProps {
    open: boolean
    onClose: () => void
    /** Every agent in the project, minus the one being edited. */
    options: SubagentOption[]
    loading?: boolean
    /** Fires with the chosen agents, in the order they appear in `options`. */
    onAdd: (selected: SubagentOption[]) => void
}

const ICON_BOX = "flex size-9 shrink-0 items-center justify-center rounded-md"

/** Plural that reads as a sentence, so the button never says "Add 1 subagents". */
const addLabel = (n: number) =>
    n === 0 ? "Add subagents" : n === 1 ? "Add subagent" : `Add ${n} subagents`

/**
 * The model an agent runs on. Muted, because it qualifies the agent rather than naming it. The
 * provider's own mark carries the recognition, the same way the integration strip below uses logos.
 */
function ModelChip({model, provider}: {model: string; provider?: string}) {
    const ProviderIcon = provider ? LLMIconMap[provider] : undefined
    return (
        <span className="flex min-w-0 items-center gap-1 text-xs text-[var(--ag-colorTextSecondary)]">
            {ProviderIcon ? (
                <ProviderIcon className="size-3 shrink-0" />
            ) : (
                <Cube size={12} className="shrink-0" />
            )}
            <span className="truncate">{model}</span>
        </span>
    )
}

/**
 * The apps an agent can reach. Logos carry the recognition, so the names sit next to them at the
 * same weight as the model rather than as tags competing with the agent's own name.
 */
function IntegrationStrip({integrations}: {integrations: SubagentIntegration[]}) {
    if (integrations.length === 0) {
        return <span className="text-xs text-[var(--ag-colorTextTertiary)]">No connected apps</span>
    }
    return (
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {integrations.map((integration) => (
                <span
                    key={integration.key}
                    className="flex items-center gap-1 text-xs text-[var(--ag-colorTextSecondary)]"
                >
                    <ProviderLogo logo={integration.logo} size={14} />
                    <span className="truncate">{integration.name || integration.key}</span>
                </span>
            ))}
        </span>
    )
}

/**
 * One agent. The whole card toggles, so the pointer target is the card and not the 16px checkbox;
 * the checkbox stays as the state read-out and the keyboard's own affordance.
 */
function SubagentCard({
    option,
    selected,
    onToggle,
}: {
    option: SubagentOption
    selected: boolean
    onToggle: () => void
}) {
    const chrome = agentIconChrome(option.icon, {
        size: 18,
        fallbackGlyph: <Robot size={18} />,
        fallbackClassName: "bg-[var(--ag-colorFillTertiary)] text-[var(--ag-colorTextSecondary)]",
    })
    const integrations = option.integrations ?? []

    if (option.added) {
        return (
            <div className="flex items-start gap-3 rounded-lg border border-[var(--ag-colorBorderSecondary)] px-3 py-2.5 opacity-60">
                <span className="mt-0.5 size-4 shrink-0" />
                <span className={cn(ICON_BOX, chrome.className)} style={chrome.style}>
                    {chrome.glyph}
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{option.name}</span>
                        <Badge variant="default">Added</Badge>
                    </span>
                    {option.description ? (
                        <span className="line-clamp-2 text-xs text-[var(--ag-colorTextSecondary)]">
                            {option.description}
                        </span>
                    ) : null}
                </span>
            </div>
        )
    }

    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={selected}
            onClick={onToggle}
            className={cn(
                "flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ag-colorPrimary)]",
                selected
                    ? "border-[var(--ag-colorPrimary)] bg-[var(--ag-colorPrimaryBg)]"
                    : "border-[var(--ag-colorBorderSecondary)] bg-[var(--ag-colorBgContainer)] hover:border-[var(--ag-colorBorder)] hover:bg-[var(--ag-colorFillQuaternary)]",
            )}
        >
            {/* The card owns the click, so the box is a read-out and must not take one of its own. */}
            <Checkbox checked={selected} tabIndex={-1} className="pointer-events-none mt-0.5" />
            <span className={cn(ICON_BOX, chrome.className)} style={chrome.style}>
                {chrome.glyph}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="truncate text-sm font-medium">{option.name}</span>
                {option.description ? (
                    <span className="line-clamp-2 text-xs text-[var(--ag-colorTextSecondary)]">
                        {option.description}
                    </span>
                ) : null}
                <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                    {option.model ? (
                        <ModelChip model={option.model} provider={option.provider} />
                    ) : null}
                    <IntegrationStrip integrations={integrations} />
                </span>
            </span>
        </button>
    )
}

function CardSkeleton() {
    return (
        <div className="flex items-start gap-3 rounded-lg border border-[var(--ag-colorBorderSecondary)] px-3 py-2.5">
            <Skeleton className="mt-0.5 size-4 rounded" />
            <Skeleton className="size-9 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-24" />
            </div>
        </div>
    )
}

export function AddSubagentDrawer({
    open,
    onClose,
    options,
    loading,
    onAdd,
}: AddSubagentDrawerProps) {
    const [search, setSearch] = useState("")
    const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())

    // Already-added agents are listed for context but can never be selected, so they stay out of
    // every count and out of select-all.
    const selectable = useMemo(() => options.filter((o) => !o.added), [options])

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return options
        return options.filter(
            (o) =>
                o.name.toLowerCase().includes(q) || (o.description ?? "").toLowerCase().includes(q),
        )
    }, [options, search])

    // Select-all acts on what the search is showing. Acting on the hidden rest would let one click
    // add agents the author cannot see.
    const visibleSelectable = useMemo(() => visible.filter((o) => !o.added), [visible])
    const visibleSelectedCount = visibleSelectable.filter((o) => selectedIds.has(o.id)).length
    const allVisibleSelected =
        visibleSelectable.length > 0 && visibleSelectedCount === visibleSelectable.length

    const toggle = (id: string) =>
        setSelectedIds((prev) => {
            const next = new Set(prev)
            if (next.has(id)) next.delete(id)
            else next.add(id)
            return next
        })

    const toggleAllVisible = () =>
        setSelectedIds((prev) => {
            const next = new Set(prev)
            if (allVisibleSelected) visibleSelectable.forEach((o) => next.delete(o.id))
            else visibleSelectable.forEach((o) => next.add(o.id))
            return next
        })

    const selectedCount = selectedIds.size

    const handleAdd = () => {
        onAdd(selectable.filter((o) => selectedIds.has(o.id)))
        setSelectedIds(new Set())
        setSearch("")
    }

    const handleClose = () => {
        setSelectedIds(new Set())
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
                <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                        <Robot size={16} />
                        <span className="text-sm font-medium">Add subagents</span>
                    </div>
                    <span className="text-xs font-normal text-[var(--ag-colorTextSecondary)]">
                        Pick the agents this agent can call.
                    </span>
                </div>
            }
            styles={{
                body: {padding: 0, display: "flex", flexDirection: "column", overflow: "hidden"},
            }}
            footer={
                <DrawerFooter
                    left={
                        selectedCount > 0 ? (
                            <span className="text-xs text-[var(--ag-colorTextSecondary)]">
                                {selectedCount} selected
                            </span>
                        ) : undefined
                    }
                    onCancel={handleClose}
                    onSubmit={handleAdd}
                    submitLabel={addLabel(selectedCount)}
                    canSave={selectedCount > 0}
                />
            }
        >
            <div className="flex shrink-0 flex-col gap-3 px-6 pb-3 pt-4">
                <SearchInput
                    placeholder="Search agents"
                    aria-label="Search agents"
                    value={search}
                    onValueChange={setSearch}
                />
                {visibleSelectable.length > 0 ? (
                    <div className="flex items-center justify-between">
                        <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--ag-colorTextSecondary)]">
                            <Checkbox
                                checked={
                                    allVisibleSelected
                                        ? true
                                        : visibleSelectedCount > 0
                                          ? "indeterminate"
                                          : false
                                }
                                onCheckedChange={toggleAllVisible}
                                aria-label="Select all agents"
                            />
                            Select all
                        </label>
                        <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                            {visibleSelectedCount} of {visibleSelectable.length} selected
                        </span>
                    </div>
                ) : null}
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-6 pb-4">
                {loading ? (
                    <>
                        <CardSkeleton />
                        <CardSkeleton />
                        <CardSkeleton />
                    </>
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
                    visible.map((option) => (
                        <SubagentCard
                            key={option.id}
                            option={option}
                            selected={selectedIds.has(option.id)}
                            onToggle={() => toggle(option.id)}
                        />
                    ))
                )}
            </div>
        </EnhancedDrawer>
    )
}
