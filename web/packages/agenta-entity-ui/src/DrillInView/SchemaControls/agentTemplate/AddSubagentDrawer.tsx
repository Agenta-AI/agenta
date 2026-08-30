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
import {useEffect, useMemo, useState} from "react"

import {agentIconChrome, type AgentIconSelection} from "@agenta/ui/agent-icon"
import {LogoMarks} from "@agenta/ui/components/presentational"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {LLMIconMap} from "@agenta/ui/llm-icons"
import {cn} from "@agenta/ui/styles"
import {Button, EmptyState, SearchInput, SkeletonBlock} from "@agenta/ui/ui"
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

const ICON_BOX = "flex size-7 items-center justify-center rounded-md"

/**
 * The model an agent runs on, with the provider's own mark for recognition. The mark sits in a
 * tile the same size as an integration logo, so the meta line reads as one run of marks.
 *
 * Tabular numerals: model names are mostly version digits, and proportional ones make a column of
 * them look ragged.
 */
function ModelChip({model, provider}: {model: string; provider?: string}) {
    const ProviderIcon = provider ? LLMIconMap[provider] : undefined
    return (
        <span className="flex min-w-0 items-center gap-[5px] text-xs text-[var(--ag-colorTextSecondary)]">
            <span className="flex size-[13px] shrink-0 items-center justify-center rounded-[3px] bg-[var(--ag-colorFillTertiary)]">
                {ProviderIcon ? <ProviderIcon className="size-[9px]" /> : <Cube size={9} />}
            </span>
            <span className="truncate tabular-nums">{model}</span>
        </span>
    )
}

/** Separates the model from the connected apps. A gap alone let the two runs read as one list. */
const MetaDot = () => (
    <span className="size-[2px] shrink-0 rounded-full bg-[var(--ag-colorTextQuaternary)]" />
)

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
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onRemove}
                        aria-label={`Remove ${option.name} as a subagent`}
                    >
                        Remove
                    </Button>
                ) : (
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={onAdd}
                        aria-label={`Add ${option.name} as a subagent`}
                    >
                        Add
                    </Button>
                )
            }
        >
            <ExpandableDescription
                description={option.description}
                lines={2}
                label={option.name}
                onExpandedChange={setExpanded}
            />
            <span className="mt-1.5 flex min-w-0 items-center gap-2">
                {option.model ? (
                    <ModelChip model={option.model} provider={option.provider} />
                ) : null}
                {option.model ? <MetaDot /> : null}
                <LogoMarks
                    items={integrations}
                    size={14}
                    max={5}
                    label={`Apps connected to ${option.name}`}
                    empty={
                        <span className="text-xs text-[var(--ag-colorTextTertiary)]">
                            No connected apps
                        </span>
                    }
                />
            </span>
        </CatalogListRow>
    )
}

/**
 * A loading row. Deliberately NOT built on CatalogListRow: that component wraps its title in a
 * truncating span, which is right for text and collapses a block-level bar. The geometry is copied
 * instead, so the skeleton keeps the row's anatomy (icon, two text lines, a meta line, an action)
 * and the list does not jump when the agents land.
 *
 * SkeletonBlock, never Skeleton: `Skeleton` is the antd COMPOSITE and renders a title plus three
 * paragraph rows. Sizing it with a className gives four overlapping bars in a box meant for one,
 * which is the staircase its own doc comment warns about.
 */
function RowSkeleton({widths}: {widths: [string, string]}) {
    return (
        <div className="flex items-start gap-2.5 border-0 border-t border-solid border-[var(--ag-colorSplit)] px-3 py-2.5 first:border-t-0">
            <SkeletonBlock className="mt-px size-7 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex min-h-6 items-center">
                    <SkeletonBlock className={`h-3.5 ${widths[0]}`} />
                </div>
                <SkeletonBlock className={`h-3 ${widths[1]}`} />
                <SkeletonBlock className="h-3 w-28" />
            </div>
            <SkeletonBlock className="h-6 w-14 shrink-0 rounded-md" />
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
    onAdd,
    onRemove,
}: AddSubagentDrawerProps) {
    const [search, setSearch] = useState("")

    // Reset on the `open` transition, not only in handleClose: `destroyOnClose` unmounts the
    // drawer's body, not this component, so a close driven by the parent kept the last search
    // and the next open showed a filtered list with no visible reason.
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
                    <div className="flex flex-col overflow-hidden rounded-md border border-solid border-[var(--ag-colorBorderSecondary)]">
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
                        <div className="flex flex-col overflow-hidden rounded-md border border-solid border-[var(--ag-colorBorderSecondary)]">
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
