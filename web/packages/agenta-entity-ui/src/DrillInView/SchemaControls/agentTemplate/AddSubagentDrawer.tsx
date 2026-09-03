/** Pick the agents this agent can call. Presentational: every agent arrives as a prop. */
import {useEffect, useMemo, useState} from "react"

import {agentIconChrome, type AgentIconSelection} from "@agenta/ui/agent-icon"
import {LogoMarks} from "@agenta/ui/components/presentational"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {getProviderIcon} from "@agenta/ui/select-llm-provider"
import {cn} from "@agenta/ui/styles"
import {Button, EmptyState, SearchInput, SkeletonBlock} from "@agenta/ui/ui"
import {Check, Cube, Robot, Warning} from "@phosphor-icons/react"

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

const ICON_BOX = "flex size-7 items-center justify-center rounded-md"

/** The model an agent runs on, marked with its provider's logo. */
function ModelChip({model, provider}: {model: string; provider?: string}) {
    const ProviderIcon = provider ? getProviderIcon(provider) : null
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
    busy,
    onAdd,
    onRemove,
}: {
    option: SubagentOption
    busy?: boolean
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
                        disabled={busy}
                        onClick={onRemove}
                        aria-label={`Remove ${option.name} as a subagent`}
                    >
                        Remove
                    </Button>
                ) : (
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
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

/** A loading row. SkeletonBlock, never Skeleton: the latter is the antd composite and draws four
 *  overlapping bars in a box meant for one. CatalogListRow truncates its title, which collapses a bar. */
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

    // Add all acts on what the search shows, never on hidden rows.
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

                {failedCount > 0 ? (
                    <div className="flex items-center gap-2 rounded-md border border-solid border-[var(--ag-colorWarningBorder)] bg-[var(--ag-colorWarningBg)] px-3 py-2 text-xs text-[var(--ag-colorWarningText)]">
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
                                        disabled={busy}
                                        onClick={() => void run(() => onAdd(addable))}
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
                                    busy={busy}
                                    onAdd={() => void run(() => onAdd([option]))}
                                    onRemove={() => void run(() => onRemove([option]))}
                                />
                            ))}
                        </div>
                    </div>
                )}
            </div>
        </EnhancedDrawer>
    )
}
