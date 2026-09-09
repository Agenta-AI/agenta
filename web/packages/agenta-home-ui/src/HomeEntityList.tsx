import {useCallback, useEffect, useRef, useState, type ReactNode} from "react"

import {
    templateProviderSlugs,
    type AgentStarterTemplate,
} from "@agenta/entities/workflow"
import {AgentChip} from "@agenta/entity-ui/agent"
import {ArrowRightIcon, ListBulletsIcon, PlusIcon} from "@phosphor-icons/react"

import {TemplateProviderMarks} from "./TemplateProviderMarks"

/** Which source the one list region is showing. The two never occupy the page at once. */
export type HomeListTab = "agents" | "templates"

export interface HomeListAgent {
    id: string
    name: string
    description?: string | null
}

export interface HomeEntityListProps {
    tab: HomeListTab
    onTabChange: (tab: HomeListTab) => void
    agents: HomeListAgent[]
    templates: AgentStarterTemplate[]
    /** Bind this agent to the composer above. */
    onSelectAgent: (agentId: string) => void
    /** The agent the composer is bound to, tinted in the list so the two read as one control. */
    selectedAgentId?: string | null
    /** Likewise for a bound template. */
    selectedTemplateKey?: string | null
    /** Build an agent from this template. */
    onPickTemplate: (template: AgentStarterTemplate) => void
    /** The full gallery, from the row that closes the templates tab. */
    templatesHref: string
    /** Flip the composer into create mode. */
    onNew: () => void
    /** The agents tab's states — the host's, so they carry its own designed versions. */
    loading?: boolean
    loadingSlot?: ReactNode
    emptySlot?: ReactNode
    errorSlot?: ReactNode
}

const TAB_BASE =
    "box-border cursor-pointer appearance-none border-0 border-b-2 border-solid bg-transparent px-0.5 pb-[7px] font-[inherit] text-sm leading-[1.4] outline-none transition-colors"
const TAB_ON = "border-b-foreground font-medium text-foreground"
const TAB_OFF = "border-b-transparent font-normal text-muted-foreground hover:text-foreground"

/** How many templates the tab shows before handing off to the gallery. */
const TEMPLATE_SHORTLIST = 5

const ROW =
    "box-border flex w-full cursor-pointer appearance-none items-center gap-3.5 rounded-[10px] border-0 bg-transparent px-3.5 py-2 text-left font-[inherit] outline-none transition-colors hover:bg-accent"

/** One row: a tile, the name over its description, and whatever marks the source carries. */
const Row = ({
    tile,
    name,
    description,
    marks,
    selected,
    onClick,
}: {
    tile: ReactNode
    name: string
    description?: string | null
    marks?: ReactNode
    selected?: boolean
    onClick: () => void
}) => (
    <button type="button" onClick={onClick} className={`${ROW} ${selected ? "bg-accent" : ""}`}>
        {tile}
        {/* The description line renders even when empty, so rows keep one height and the column
            does not comb. */}
        <span className="flex min-w-0 flex-1 flex-col gap-px">
            <span className="truncate text-sm leading-[1.45] text-foreground">{name}</span>
            <span className="truncate text-[13px] leading-[1.45] text-muted-foreground">
                {description?.trim() || "No description"}
            </span>
        </span>
        {marks ? <span className="flex shrink-0 items-center pl-2">{marks}</span> : null}
    </button>
)

/**
 * Home's one list region, switched between the agents you have and the templates you could start
 * from. One region rather than two sections: the page asks a single question, and two lists of
 * things to click under it made the reader choose which list to read first.
 *
 * The fades are the list's own scroll state, not a decoration — a hard edge at 330px reads as the
 * end of the agents you have.
 */
export const HomeEntityList = ({
    tab,
    onTabChange,
    agents,
    templates,
    onSelectAgent,
    selectedAgentId,
    selectedTemplateKey,
    onPickTemplate,
    templatesHref,
    onNew,
    loading,
    loadingSlot,
    emptySlot,
    errorSlot,
}: HomeEntityListProps) => {
    const scrollerRef = useRef<HTMLDivElement>(null)
    const [mask, setMask] = useState<string>("none")

    const readScroll = useCallback(() => {
        const el = scrollerRef.current
        if (!el) return
        const max = el.scrollHeight - el.clientHeight
        const top = el.scrollTop > 4
        const bottom = max > 4 && el.scrollTop < max - 4
        const next =
            !top && !bottom
                ? "none"
                : `linear-gradient(to bottom, transparent 0, #000 ${top ? "26px" : "0"}, #000 ${
                      bottom ? "calc(100% - 34px)" : "100%"
                  }, transparent 100%)`
        // Idempotent, so this is safe to call on every render.
        setMask((current) => (current === next ? current : next))
    }, [])

    // Measured on every render, not only on scroll: the bottom fade IS the signal that there is
    // more below, so a list that overflows on arrival has to show it before it is ever touched.
    // Content height changes under a capped box without resizing it, so there is nothing cheaper
    // (a ResizeObserver on the scroller never fires for it).
    useEffect(readScroll)

    // The window's width changes how many rows fit; the height they occupy is what the mask reads.
    useEffect(() => {
        window.addEventListener("resize", readScroll)
        return () => window.removeEventListener("resize", readScroll)
    }, [readScroll])

    const switchTab = (next: HomeListTab) => {
        onTabChange(next)
        // A new source starts at its own top; keeping the offset showed row 6 of a 4-row list.
        if (scrollerRef.current) scrollerRef.current.scrollTop = 0
    }

    const showAgents = tab === "agents"
    const agentsBody = errorSlot ?? (loading ? loadingSlot : agents.length === 0 ? emptySlot : null)

    return (
        // The list bleeds 8px past the column on each side and hands it straight back as row
        // padding: the hover fill needs room around the tile, and the tile cannot move — it is
        // what the tab above it lines up with. The bleed is on this wrapper, not on the rows, so
        // nothing overflows the scroller and no horizontal scrollbar appears.
        <div className="-mx-2 flex flex-col gap-2">
            {/* `colorSplit`, the divider step — the active tab's underline is the mark that
                matters here, and a rule at full border weight competed with it. */}
            {/* `mx-2` gives back the wrapper's bleed: the rows may run wide, but a rule that did
                would sit proud of the composer above it. */}
            <div className="mb-1 mx-2 flex items-center gap-5 border-0 border-b border-solid border-b-[var(--ag-colorSplit)] px-1.5">
                <button
                    type="button"
                    onClick={() => switchTab("agents")}
                    className={`${TAB_BASE} ${showAgents ? TAB_ON : TAB_OFF}`}
                >
                    Your agents
                </button>
                <button
                    type="button"
                    onClick={() => switchTab("templates")}
                    className={`${TAB_BASE} ${showAgents ? TAB_OFF : TAB_ON}`}
                >
                    Templates
                </button>
                <span className="flex-1" />
                <span className="pb-[7px]">
                    <button
                        type="button"
                        onClick={onNew}
                        className="box-border flex h-7 cursor-pointer appearance-none items-center gap-1.5 rounded-control-sm border border-solid border-border bg-transparent px-2.5 font-[inherit] text-[13px] leading-none text-foreground outline-none transition-colors hover:bg-accent"
                    >
                        <PlusIcon aria-hidden size={12} />
                        New agent
                    </button>
                </span>
            </div>

            <div
                ref={scrollerRef}
                onScroll={readScroll}
                className="flex max-h-[330px] flex-col gap-0.5 overflow-y-auto"
                style={{maskImage: mask, WebkitMaskImage: mask}}
            >
                {showAgents ? (
                    (agentsBody ??
                        agents.map((agent) => (
                            <Row
                                key={agent.id}
                                tile={
                                    // The glyph, not the tile, carries the breathing room: the
                                    // box has to stay 34px or the row's left edge stops lining up
                                    // with the tab above it.
                                    <AgentChip workflowId={agent.id} box="size-[34px]" glyph={16} />
                                }
                                name={agent.name}
                                description={agent.description}
                                selected={agent.id === selectedAgentId}
                                onClick={() => onSelectAgent(agent.id)}
                            />
                        )))
                ) : (
                    <>
                        {templates.slice(0, TEMPLATE_SHORTLIST).map((template) => (
                            <Row
                                key={template.key}
                                tile={
                                    // Solid fill, white monogram — the template palette is the
                                    // white-safe deep steps, so the colour is only legible AS a
                                    // fill. Same tile the strip cards and the New agent menu draw.
                                    <span
                                        className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] text-[13px] font-medium text-white"
                                        style={{background: template.color}}
                                    >
                                        {template.initials}
                                    </span>
                                }
                                name={template.name}
                                description={template.overview || template.description}
                                selected={template.key === selectedTemplateKey}
                                marks={
                                    <TemplateProviderMarks
                                        stacked
                                        providers={templateProviderSlugs(template)}
                                    />
                                }
                                onClick={() => onPickTemplate(template)}
                            />
                        ))}
                        {/* The tab shows a shortlist; this is where the rest of them live. */}
                        <a href={templatesHref} className={`${ROW} no-underline`}>
                            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[10px] border border-dashed border-border text-muted-foreground">
                                <ListBulletsIcon aria-hidden size={17} />
                            </span>
                            <span className="flex-1 text-sm leading-[1.45] text-foreground">
                                Browse all {templates.length} templates
                            </span>
                            <ArrowRightIcon aria-hidden size={13} className="text-muted-foreground" />
                        </a>
                    </>
                )}
            </div>
        </div>
    )
}
