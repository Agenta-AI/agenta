import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {agentWorkflowsListQueryStateAtom, type Workflow} from "@agenta/entities/workflow"
import {Popover, PopoverContent, PopoverTrigger, SkeletonBlock} from "@agenta/ui/ui"
import {Check, MagnifyingGlass, Plus, Robot} from "@phosphor-icons/react"
import {CaretDown} from "@phosphor-icons/react"
import {useAtomValue} from "jotai"

import {useAgentIconChrome} from "./agentIcon"

/** How much of an agent a row shows. `relaxed` adds the description line under the name. */
export type AgentPickerDensity = "relaxed" | "compact"

/** The shape of the control that opens the panel. */
export type AgentPickerTriggerVariant = "field" | "pill"

export interface AgentPickerProps {
    /** The bound agent, by workflow id. */
    value?: string | null
    onChange: (agentId: string) => void
    /** Absent ⇒ the control reads as a bound fact rather than offering a dead tap target. */
    disabled?: boolean
    /**
     * `field` fills its container like a form control; `pill` hugs its label, for a toolbar or a
     * composer. The panel is identical either way.
     */
    trigger?: AgentPickerTriggerVariant
    density?: AgentPickerDensity
    /** Shown when a "New agent" row should close the list. Absent ⇒ no row. */
    onCreateAgent?: () => void
    createLabel?: string
    placeholder?: string
    searchPlaceholder?: string
    /**
     * The bound agent's name when the agents list cannot resolve it — the playground binds by
     * REVISION id, which is not in the list, so the host passes the label it already has.
     */
    fallbackName?: string | null
    triggerAriaLabel?: string
    triggerClassName?: string
    contentClassName?: string
    side?: "top" | "right" | "bottom" | "left"
    align?: "start" | "center" | "end"
}

const agentLabel = (agent: Workflow): string =>
    agent.name?.trim() || agent.slug?.trim() || "Untitled agent"

const agentDescription = (agent: Workflow): string => agent.description?.trim() ?? ""

/**
 * The panel with nothing to list — the same frame the other pickers in this codebase use: a
 * glyph in a rounded tile, a line that names the fact, a line that says what to do next.
 */
const AgentPickerEmpty = ({
    icon,
    title,
    body,
    action,
}: {
    icon: React.ReactNode
    title: string
    body: string
    action?: React.ReactNode
}) => (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
        <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-muted text-muted-foreground">
            {icon}
        </span>
        <p className="m-0 text-[13px] font-medium text-foreground">{title}</p>
        <p className="m-0 max-w-[34ch] text-[12px] leading-snug text-placeholder">{body}</p>
        {action}
    </div>
)

/**
 * The agent's mark as a tile: its own colour when it has an icon, a neutral fill when not.
 *
 * Exported because the tile is not the picker's — any list that names agents wants the same one,
 * and a second implementation is how two columns of the same agents stop matching. `colorFillSecondary`
 * for the neutral case: `muted` sits within a hair of a popover's own surface in dark mode.
 */
export const AgentChip = ({
    workflowId,
    box = "size-7",
    glyph = 16,
}: {
    workflowId: string | null
    /** Tile size. A row can afford a 28px tile; a field control sits better at 20px. */
    box?: string
    glyph?: number
}) => {
    const chrome = useAgentIconChrome(workflowId, {
        size: glyph,
        fallbackGlyph: <Robot aria-hidden size={glyph} />,
    })
    return (
        <span
            className={[
                "flex shrink-0 items-center justify-center rounded-control-sm",
                box,
                // An agent with no icon of its own still gets a tile: a column where some rows
                // have one and some do not reads as a rendering fault, not as a distinction.
                // `colorFillSecondary`, not `muted`: muted sits within a hair of the popover's own
                // surface in dark mode, so the neutral tiles vanished while the coloured ones
                // stayed. This is the fill the agent chrome itself uses for an unpicked icon.
                chrome.customised
                    ? chrome.className
                    : "bg-colorFillSecondary text-muted-foreground",
            ].join(" ")}
            style={chrome.style}
        >
            {chrome.glyph}
        </span>
    )
}

const AgentPickerRow = ({
    agent,
    density,
    selected,
    rowRef,
    onKeyDown,
    onSelect,
}: {
    agent: Workflow
    density: AgentPickerDensity
    selected: boolean
    rowRef: (node: HTMLButtonElement | null) => void
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void
    onSelect: () => void
}) => {
    const description = agentDescription(agent)
    return (
        <button
            ref={rowRef}
            type="button"
            role="option"
            aria-selected={selected}
            onKeyDown={onKeyDown}
            onClick={onSelect}
            className={[
                "box-border flex w-full cursor-pointer appearance-none items-center gap-2",
                "rounded-control-sm border-0 px-2 py-1.5 text-left font-[inherit] text-[13px]",
                "text-foreground outline-none transition-colors",
                // The bound agent keeps a tint of its own, so "which one is this set to" survives
                // the pointer moving down the list — a selected row that only differs by a check
                // mark loses its answer the moment something else is hovered.
                selected
                    ? "bg-primary/10 hover:bg-primary/15 focus-visible:bg-primary/15"
                    : "bg-transparent hover:bg-accent focus-visible:bg-accent",
            ].join(" ")}
        >
            <AgentChip workflowId={String(agent.id)} />
            <span className="flex min-w-0 flex-1 flex-col">
                {/* One weight down the column: bolding the bound agent made the list look like
                    it had a heading in the middle of it. The tint and the check say enough. */}
                <span className="min-w-0 truncate">{agentLabel(agent)}</span>
                {/* The description is the row's second line, never a tooltip: what an agent does
                    is how it is recognised. Said even when there is none, so the rows keep one
                    height and a blank line never reads as a description that failed to load. */}
                {density === "relaxed" ? (
                    <span
                        className={[
                            "min-w-0 truncate text-[12px]",
                            // Fainter than the name it sits under: the description is what you
                            // scan when the name did not settle it, never the row's first read.
                            description ? "text-placeholder" : "text-placeholder/70",
                        ].join(" ")}
                    >
                        {description || "No description"}
                    </span>
                ) : null}
            </span>
            {selected ? <Check aria-hidden size={14} className="shrink-0 text-foreground" /> : null}
        </button>
    )
}

/**
 * The one way to choose an agent.
 *
 * Every surface that binds an agent — an automation, a composer, a panel — opens THIS, so the
 * search, the ordering, the glyphs and the "New agent" affordance cannot drift between them.
 * The two densities in the design are one component: `relaxed` prints each agent's description
 * under its name for a screen with room to explain, `compact` prints the name alone for a
 * toolbar. Nothing else differs, so a reader who learns one has learned both.
 *
 * It fetches its own agents. A picker whose host has to hand it a list is a picker every host
 * gets to populate differently, which is the drift this component exists to end.
 *
 * A Popover rather than a Select: a select's built-in typeahead competes with the search field
 * for every keystroke, the same reason `@agenta/ui/filter-menu` is built this way.
 */
export const AgentPicker = ({
    value = null,
    onChange,
    disabled = false,
    trigger = "field",
    density = "compact",
    onCreateAgent,
    createLabel = "New agent",
    placeholder = "Pick an agent",
    searchPlaceholder = "Search agents",
    fallbackName = null,
    triggerAriaLabel = "Agent",
    triggerClassName,
    contentClassName,
    side = "bottom",
    align = "start",
}: AgentPickerProps) => {
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState("")
    const searchRef = useRef<HTMLInputElement | null>(null)
    const rowRefs = useRef(new Map<string, HTMLButtonElement | null>())

    const agentsQuery = useAtomValue(agentWorkflowsListQueryStateAtom)
    const agents = useMemo<Workflow[]>(() => agentsQuery.data ?? [], [agentsQuery.data])

    const selected = useMemo(
        () => agents.find((agent) => agent.id === value) ?? null,
        [agents, value],
    )
    const selectedLabel = selected ? agentLabel(selected) : (fallbackName ?? null)

    // Name AND description: an agent is often easier to recall by what it does ("posts to
    // #news") than by what someone called it.
    const matched = useMemo(() => {
        const term = query.trim().toLowerCase()
        if (!term) return agents
        return agents.filter((agent) =>
            `${agentLabel(agent)} ${agentDescription(agent)}`.toLowerCase().includes(term),
        )
    }, [agents, query])

    // Opening on a stale search would hide the agent someone came back for.
    useEffect(() => {
        if (!open) setQuery("")
    }, [open])

    const pick = useCallback(
        (agentId: string) => {
            onChange(agentId)
            setOpen(false)
        },
        [onChange],
    )

    const onSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "ArrowDown") return
        event.preventDefault()
        const first = matched[0]?.id
        if (first) rowRefs.current.get(first)?.focus()
    }

    const onRowKeyDown = (index: number) => (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
        event.preventDefault()
        const step = event.key === "ArrowDown" ? 1 : -1
        const next = index + step
        if (next < 0) {
            searchRef.current?.focus()
            return
        }
        const target = matched[next]?.id
        if (target) rowRefs.current.get(target)?.focus()
    }

    const triggerNode =
        trigger === "pill" ? (
            <button
                type="button"
                aria-label={triggerAriaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled}
                className={[
                    "box-border cursor-pointer appearance-none border-0 font-[inherit]",
                    "inline-flex min-w-0 items-center gap-2 rounded-control bg-muted px-2 py-1",
                    "text-[13px] font-medium text-foreground outline-none transition-colors",
                    "hover:bg-accent focus-visible:bg-accent disabled:cursor-default",
                    triggerClassName,
                ]
                    .filter(Boolean)
                    .join(" ")}
            >
                <AgentChip workflowId={value} box="size-5" glyph={13} />
                <span className="min-w-0 truncate">{selectedLabel ?? placeholder}</span>
                <CaretDown aria-hidden size={12} className="shrink-0 text-muted-foreground" />
            </button>
        ) : (
            // Same geometry as the app's own Select trigger, so this sits level with the fields
            // around it rather than announcing itself as a different kind of control.
            <button
                type="button"
                aria-label={triggerAriaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                disabled={disabled}
                className={[
                    "box-border border-solid font-[inherit]",
                    "flex w-full cursor-pointer items-center justify-between gap-1 border text-left",
                    "px-input py-input-y text-field-md rounded-control text-foreground",
                    "bg-background border-border outline-none transition-colors",
                    "hover:border-btn-primary-hover focus:border-primary",
                    "focus:shadow-[0_0_0_2px_var(--ag-controlOutline)]",
                    "data-[state=open]:border-primary",
                    "data-[state=open]:shadow-[0_0_0_2px_var(--ag-controlOutline)]",
                    "disabled:cursor-default disabled:border-border disabled:bg-background",
                    triggerClassName,
                ]
                    .filter(Boolean)
                    .join(" ")}
            >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                    <AgentChip workflowId={value} box="size-5" glyph={13} />
                    <span
                        className={[
                            "min-w-0 truncate",
                            selectedLabel ? "" : "text-placeholder",
                        ].join(" ")}
                    >
                        {selectedLabel ?? placeholder}
                    </span>
                </span>
                <CaretDown aria-hidden size={12} className="shrink-0 text-muted-foreground" />
            </button>
        )

    return (
        <Popover open={open} onOpenChange={disabled ? undefined : setOpen}>
            <PopoverTrigger asChild>{triggerNode}</PopoverTrigger>
            <PopoverContent
                side={side}
                align={align}
                sideOffset={6}
                aria-label={triggerAriaLabel}
                className={[
                    "flex w-[var(--radix-popover-trigger-width)] min-w-[260px] flex-col gap-0 p-0",
                    contentClassName,
                ]
                    .filter(Boolean)
                    .join(" ")}
                // Radix focuses the content wrapper on open, which beats an input's own
                // `autoFocus`; the entry point is chosen here instead — a frame late, because on
                // the opening frame the content is still being positioned.
                onOpenAutoFocus={(event) => {
                    event.preventDefault()
                    requestAnimationFrame(() => searchRef.current?.focus())
                }}
            >
                {/* The glass takes the WIDTH the rows give their chips, at the same 12px indent,
                    so the icons and the two text columns share one pair of edges. Width only —
                    matching the chip's height too would make the search field taller than a
                    field needs to be. */}
                <label className="flex items-center gap-2 border-0 border-b border-solid border-border px-3 py-2">
                    <span className="flex w-7 shrink-0 items-center justify-center">
                        <MagnifyingGlass size={14} aria-hidden className="text-muted-foreground" />
                    </span>
                    <input
                        ref={searchRef}
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={searchPlaceholder}
                        aria-label={searchPlaceholder}
                        onKeyDown={onSearchKeyDown}
                        className="box-border w-full appearance-none border-0 bg-transparent p-0 font-[inherit] text-[13px] text-foreground outline-none placeholder:text-placeholder"
                    />
                </label>

                <div className="flex max-h-[280px] flex-col gap-px overflow-y-auto p-1">
                    {agentsQuery.isPending ? (
                        // Row geometry, not a spinner — the list replaces this without shifting.
                        <>
                            <SkeletonBlock active className="h-8 w-full" />
                            <SkeletonBlock active className="h-8 w-4/5" />
                            <SkeletonBlock active className="h-8 w-3/5" />
                        </>
                    ) : matched.length === 0 ? (
                        // Two different facts: a project with no agents yet, and a search that
                        // matched none of the ones it has. Telling a reader "no agents" while
                        // five sit behind a typo sends them looking for a fault that is not there.
                        agents.length === 0 ? (
                            <AgentPickerEmpty
                                icon={<Robot aria-hidden size={19} />}
                                title="No agents yet"
                                body="An agent is what does the work. Make one and it shows up here."
                                action={
                                    onCreateAgent ? (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setOpen(false)
                                                onCreateAgent()
                                            }}
                                            className="mt-1 box-border inline-flex cursor-pointer appearance-none items-center gap-1.5 rounded-control-sm border-0 bg-muted px-2.5 py-1.5 font-[inherit] text-[12px] font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                                        >
                                            <Plus aria-hidden size={13} />
                                            {createLabel}
                                        </button>
                                    ) : null
                                }
                            />
                        ) : (
                            <AgentPickerEmpty
                                icon={<MagnifyingGlass aria-hidden size={19} />}
                                title={`No agents match “${query.trim()}”`}
                                body="The search covers each agent's name and what it does."
                                action={
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setQuery("")
                                            searchRef.current?.focus()
                                        }}
                                        className="mt-1 box-border inline-flex cursor-pointer appearance-none items-center rounded-control-sm border-0 bg-muted px-2.5 py-1.5 font-[inherit] text-[12px] font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                                    >
                                        Clear search
                                    </button>
                                }
                            />
                        )
                    ) : (
                        matched.map((agent, index) =>
                            agent.id ? (
                                <AgentPickerRow
                                    key={agent.id}
                                    agent={agent}
                                    density={density}
                                    selected={agent.id === value}
                                    rowRef={(node) => {
                                        rowRefs.current.set(agent.id as string, node)
                                    }}
                                    onKeyDown={onRowKeyDown(index)}
                                    onSelect={() => pick(agent.id as string)}
                                />
                            ) : null,
                        )
                    )}
                </div>

                {onCreateAgent ? (
                    // Its own footer padding rather than a rule: the plus and the shorter row
                    // already say this is an action, and a hairline over it read as a seam. The
                    // top padding is the separation the rule used to provide.
                    <div className="flex flex-col px-1 pb-1 pt-2">
                        <button
                            type="button"
                            onClick={() => {
                                setOpen(false)
                                onCreateAgent()
                            }}
                            // Tighter than a list row: this is a footer action, not one of the
                            // choices, and at row height it read as an eighth agent.
                            className="box-border flex w-full cursor-pointer appearance-none items-center gap-2 rounded-control-sm border-0 bg-transparent px-2 py-1 text-left font-[inherit] text-[13px] text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent"
                        >
                            <span className="flex size-5 shrink-0 items-center justify-center">
                                <Plus aria-hidden size={14} className="text-muted-foreground" />
                            </span>
                            <span className="min-w-0 truncate font-medium">{createLabel}</span>
                        </button>
                    </div>
                ) : null}
            </PopoverContent>
        </Popover>
    )
}
