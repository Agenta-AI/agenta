/**
 * AddSubagentDrawer
 *
 * Pick the agents this agent can call.
 *
 * Built on the same three pieces the integration drawer and the permission drawer use, so the two
 * agent pickers read as one surface: {@link CatalogListRow} for the row, {@link
 * ExpandableDescription} for a description that clamps and offers Show more, and `LogoMarks` for
 * the run of connected-app logos.
 *
 * Adding is per row. The row's own button adds, and the same button removes afterwards, so the
 * drawer's footer only closes. That is the integration drawer's model: an author adds several by
 * clicking several, sees each land immediately, and undoes one without leaving the drawer. Add all
 * sits on the section header, where a bulk action belongs.
 *
 * The card shows five things and nothing else: the agent's icon, its name, its description, the
 * model it runs on, and the apps it has connected. No slug, no version, no schema. An author
 * choosing a helper asks "what does this one do and what can it reach", and every field beyond
 * those five pushed that answer further down the row.
 *
 * The list is agents only, and nothing here says workflow or reference. A subagent IS saved as a
 * workflow reference, but neither word means anything to the person picking.
 *
 * Presentational on purpose: every agent arrives as a prop, so the layout can be storied and
 * iterated without the project's workflow queries.
 */
import {useMemo, useState} from "react"

import {agentIconChrome, type AgentIconSelection} from "@agenta/ui/agent-icon"
import {LogoMarks} from "@agenta/ui/components/presentational"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {LLMIconMap} from "@agenta/ui/llm-icons"
import {cn} from "@agenta/ui/styles"
import {Button, EmptyState, SearchInput, Skeleton} from "@agenta/ui/ui"
import {Check, Cube, Robot} from "@phosphor-icons/react"

import {SubSectionHeader} from "../sectionGroups"

import {CatalogListRow} from "./CatalogListRow"
import {INTEGRATION_DRAWER_WIDTH} from "./drawerWidths"
import {ExpandableDescription} from "./ExpandableDescription"

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
    /** Provider display name, e.g. "Anthropic". Draws the provider's mark next to the model; a
     *  name the icon map does not know falls back to a neutral glyph. */
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
    /** One write per author action: a row sends one agent, Add all sends the rest. */
    onAdd: (options: SubagentOption[]) => void
    onRemove: (options: SubagentOption[]) => void
}

const ICON_BOX = "flex size-6 items-center justify-center rounded"

/** The model an agent runs on, with the provider's own mark for recognition. */
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

function SubagentRow({
    option,
    onAdd,
    onRemove,
}: {
    option: SubagentOption
    onAdd: () => void
    onRemove: () => void
}) {
    const [expanded, setExpanded] = useState(false)
    const chrome = agentIconChrome(option.icon, {
        size: 14,
        fallbackGlyph: <Robot size={14} />,
        fallbackClassName: "bg-[var(--ag-colorFillSecondary)] text-[var(--ag-colorTextSecondary)]",
    })
    const integrations = option.integrations ?? []

    return (
        <CatalogListRow
            highlighted={expanded}
            leading={
                <span className={cn(ICON_BOX, chrome.className)} style={chrome.style}>
                    {chrome.glyph}
                </span>
            }
            title={option.name}
            titleSuffix={
                option.added ? (
                    <span className="flex shrink-0 items-center gap-1 text-xs font-normal text-[var(--ag-colorSuccessText)]">
                        <Check size={11} weight="bold" />
                        Added
                    </span>
                ) : null
            }
            action={
                option.added ? (
                    <Button variant="outline" size="sm" onClick={onRemove}>
                        Remove
                    </Button>
                ) : (
                    <Button variant="outline" size="sm" onClick={onAdd}>
                        Add
                    </Button>
                )
            }
        >
            <ExpandableDescription
                description={option.description}
                lines={2}
                onExpandedChange={setExpanded}
            />
            {option.model || integrations.length > 0 ? (
                <span className="mt-1 flex min-w-0 items-center gap-3">
                    {option.model ? (
                        <ModelChip model={option.model} provider={option.provider} />
                    ) : null}
                    <LogoMarks
                        items={integrations}
                        size={14}
                        max={5}
                        empty={
                            <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                                No connected apps
                            </span>
                        }
                    />
                </span>
            ) : null}
        </CatalogListRow>
    )
}

function RowSkeleton() {
    return (
        <CatalogListRow
            leading={<Skeleton className="size-6 rounded" />}
            title={<Skeleton className="h-4 w-40" />}
        >
            <Skeleton className="h-3 w-full" />
        </CatalogListRow>
    )
}

export function AddSubagentDrawer({
    open,
    onClose,
    options,
    loading,
    onAdd,
    onRemove,
}: AddSubagentDrawerProps) {
    const [search, setSearch] = useState("")

    const visible = useMemo(() => {
        const q = search.trim().toLowerCase()
        if (!q) return options
        return options.filter(
            (o) =>
                o.name.toLowerCase().includes(q) || (o.description ?? "").toLowerCase().includes(q),
        )
    }, [options, search])

    // Add all acts on what the search is showing. Acting on the hidden rest would let one click
    // add agents the author cannot see.
    const addable = useMemo(() => visible.filter((o) => !o.added), [visible])

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
            // Each row adds itself, so the only thing left for the footer is to close.
            footer={
                <div className="flex items-center justify-end">
                    <Button variant="default" onClick={handleClose}>
                        Done
                    </Button>
                </div>
            }
        >
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
                <SearchInput
                    placeholder="Search agents..."
                    aria-label="Search agents"
                    value={search}
                    onValueChange={setSearch}
                />

                {loading ? (
                    <div className="flex flex-col">
                        <RowSkeleton />
                        <RowSkeleton />
                        <RowSkeleton />
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
                    <div className="flex flex-col gap-2">
                        <SubSectionHeader
                            label="Agents"
                            count={visible.length}
                            action={
                                addable.length > 1 ? (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onAdd(addable)}
                                    >
                                        Add all
                                    </Button>
                                ) : undefined
                            }
                        />
                        <div className="flex flex-col">
                            {visible.map((option) => (
                                <SubagentRow
                                    key={option.id}
                                    option={option}
                                    onAdd={() => onAdd([option])}
                                    onRemove={() => onRemove([option])}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </EnhancedDrawer>
    )
}
